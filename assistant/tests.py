import os
import json
import tempfile
import fitz  # PyMuPDF
from unittest.mock import patch, MagicMock
from django.test import TestCase, Client
from django.urls import reverse
from django.core.files.uploadedfile import SimpleUploadedFile
from django.conf import settings
from .models import Document, DocumentChunk, ChatMessage
from .document_processor import split_text_into_chunks, process_uploaded_document, DocumentProcessingError
from .rag import FAISSIndexManager, GeminiRAGService


class DocumentProcessingTests(TestCase):
    def test_chunk_creation_and_overlap(self):
        """Verifies text chunking produces expected chunk lengths and overlaps."""
        text = "DocuMint test sentence. " * 60  # ~1440 characters
        chunks = split_text_into_chunks(text, chunk_size=500, overlap=100)
        self.assertGreaterEqual(len(chunks), 2)
        for c in chunks:
            self.assertIn('text', c)
            self.assertIn('char_start', c)
            self.assertIn('char_end', c)
            self.assertGreater(len(c['text']), 0)
            self.assertLessEqual(len(c['text']), 650)

    def test_txt_upload_and_extraction(self):
        """Tests TXT document extraction and storage in SQLite."""
        txt_content = (
            "Project name: Green Campus Initiative.\n"
            "Project budget: ₹2,50,000.\n"
            "Project deadline: 15 December 2026.\n"
            "Project lead: Aisha Khan.\n"
            "Main objective: Reduce campus electricity consumption by 20%.\n"
        ).encode('utf-8')
        uploaded = SimpleUploadedFile("green_campus.txt", txt_content, content_type="text/plain")

        doc = Document.objects.create(
            file=uploaded,
            original_filename="green_campus.txt",
            file_type="txt",
            file_size=len(txt_content),
            status=Document.STATUS_PENDING
        )

        chunks = process_uploaded_document(doc)
        doc.refresh_from_db()

        self.assertEqual(doc.status, Document.STATUS_INDEXED)
        self.assertGreater(doc.total_chunks, 0)
        self.assertEqual(doc.page_count, 1)
        self.assertIsNone(chunks[0].page_number)
        self.assertIn("Green Campus Initiative", chunks[0].text_content)

    def test_pdf_extraction_and_page_metadata(self):
        """Tests multi-page PDF generation, extraction, and page number tagging."""
        # Create a 2-page PDF in memory using PyMuPDF
        pdf_doc = fitz.open()
        page1 = pdf_doc.new_page()
        page1.insert_text((50, 72), "DocuMint First Page Content: Introduction to RAG Architecture.")
        page2 = pdf_doc.new_page()
        page2.insert_text((50, 72), "DocuMint Second Page Content: Deep FAISS Retrieval and Vector Indexing.")
        pdf_bytes = pdf_doc.tobytes()
        pdf_doc.close()

        uploaded = SimpleUploadedFile("research_doc.pdf", pdf_bytes, content_type="application/pdf")
        doc = Document.objects.create(
            file=uploaded,
            original_filename="research_doc.pdf",
            file_type="pdf",
            file_size=len(pdf_bytes),
            status=Document.STATUS_PENDING
        )

        chunks = process_uploaded_document(doc)
        doc.refresh_from_db()

        self.assertEqual(doc.status, Document.STATUS_INDEXED)
        self.assertEqual(doc.page_count, 2)
        self.assertGreaterEqual(len(chunks), 2)
        # Verify page numbers match PDF pages (1 and 2)
        page_nums = {c.page_number for c in chunks}
        self.assertIn(1, page_nums)
        self.assertIn(2, page_nums)

    def test_empty_document_handling(self):
        """Verifies empty TXT document raises DocumentProcessingError."""
        uploaded = SimpleUploadedFile("empty.txt", b"   \n  \t  ", content_type="text/plain")
        doc = Document.objects.create(
            file=uploaded,
            original_filename="empty.txt",
            file_type="txt",
            file_size=len(b"   \n  \t  "),
            status=Document.STATUS_PENDING
        )
        with self.assertRaises(DocumentProcessingError):
            process_uploaded_document(doc)
        doc.refresh_from_db()
        self.assertEqual(doc.status, Document.STATUS_ERROR)

    def test_scanned_pdf_detection(self):
        """Verifies PDF without extractable text raises OCR explanation error."""
        # PDF with no text elements
        pdf_doc = fitz.open()
        pdf_doc.new_page()
        pdf_bytes = pdf_doc.tobytes()
        pdf_doc.close()

        uploaded = SimpleUploadedFile("scanned.pdf", pdf_bytes, content_type="application/pdf")
        doc = Document.objects.create(
            file=uploaded,
            original_filename="scanned.pdf",
            file_type="pdf",
            file_size=len(pdf_bytes),
            status=Document.STATUS_PENDING
        )
        with self.assertRaises(DocumentProcessingError) as ctx:
            process_uploaded_document(doc)
        self.assertIn("Optical Character Recognition (OCR)", str(ctx.exception))


class FAISSSemanticRetrievalTests(TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.index_manager = FAISSIndexManager(storage_dir=self.temp_dir.name)
        self.rag_service = GeminiRAGService(index_manager=self.index_manager)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_embedding_generation_and_faiss_semantic_retrieval(self):
        """Verifies FAISS semantic similarity search returns relevant chunks."""
        doc = Document.objects.create(
            original_filename="campus_spec.txt",
            file_type="txt",
            file_size=500,
            status=Document.STATUS_INDEXED,
            total_chunks=2
        )
        c1 = DocumentChunk.objects.create(
            document=doc,
            chunk_index=0,
            text_content="The total approved project budget for the Green Campus Initiative is ₹2,50,000."
        )
        c2 = DocumentChunk.objects.create(
            document=doc,
            chunk_index=1,
            text_content="A variety of ornamental plants will be placed around the cafeteria courtyard."
        )

        self.index_manager.index_document(doc.id, [c1, c2])

        results = self.index_manager.search(
            query="What is the financial budget allocation for the project?",
            document_id=doc.id,
            top_k=2,
            threshold=0.25
        )
        self.assertGreaterEqual(len(results), 1)
        top_hit = results[0]
        self.assertEqual(top_hit['chunk_id'], c1.id)
        self.assertIn("₹2,50,000", top_hit['text_content'])
        self.assertGreater(top_hit['similarity_score'], 0.3)

    def test_document_filtered_retrieval(self):
        """Verifies document filtering strictly confines search to target document."""
        doc_a = Document.objects.create(
            original_filename="doc_a.txt",
            file_type="txt",
            file_size=100,
            status=Document.STATUS_INDEXED
        )
        c_a = DocumentChunk.objects.create(
            document=doc_a,
            chunk_index=0,
            text_content="Quantum computing exploits superposition and entanglement."
        )
        self.index_manager.index_document(doc_a.id, [c_a])

        doc_b = Document.objects.create(
            original_filename="doc_b.txt",
            file_type="txt",
            file_size=100,
            status=Document.STATUS_INDEXED
        )
        c_b = DocumentChunk.objects.create(
            document=doc_b,
            chunk_index=0,
            text_content="Photosynthesis converts solar energy into chemical energy in plants."
        )
        self.index_manager.index_document(doc_b.id, [c_b])

        # Filter strictly for doc_a
        results_a = self.index_manager.search(query="computing and superposition", document_id=doc_a.id, threshold=0.1)
        for r in results_a:
            self.assertEqual(r['document_id'], doc_a.id)

        # Filter strictly for doc_b
        results_b = self.index_manager.search(query="solar energy plants", document_id=doc_b.id, threshold=0.1)
        for r in results_b:
            self.assertEqual(r['document_id'], doc_b.id)

    def test_document_deletion_and_stale_index_prevention(self):
        """Verifies deleting a document removes vector index and prevents leaking chunks."""
        doc = Document.objects.create(
            original_filename="secret.txt",
            file_type="txt",
            file_size=100,
            status=Document.STATUS_INDEXED
        )
        c = DocumentChunk.objects.create(
            document=doc,
            chunk_index=0,
            text_content="Confidential project password is XYZ123."
        )
        self.index_manager.index_document(doc.id, [c])

        # Delete document index and record
        self.index_manager.delete_document_index(doc.id)
        doc.delete()

        # Query should now return empty results
        results = self.index_manager.search(query="Confidential project password", document_id=doc.id, threshold=0.1)
        self.assertEqual(len(results), 0)

    def test_unsupported_question_relevance_validation(self):
        """Verifies irrelevant question fails threshold without invoking Gemini."""
        doc = Document.objects.create(
            original_filename="campus.txt",
            file_type="txt",
            file_size=100,
            status=Document.STATUS_INDEXED
        )
        c = DocumentChunk.objects.create(
            document=doc,
            chunk_index=0,
            text_content="The campus library opens at 8:00 AM and closes at 10:00 PM on weekdays."
        )
        self.index_manager.index_document(doc.id, [c])

        # Ask question completely unrelated to document
        result = self.rag_service.answer_question(
            query="Who is the chief minister of Japan?",
            document_id=doc.id,
            session_key="test_session"
        )
        self.assertFalse(result['is_grounded'])
        self.assertEqual(result['retrieval_count'], 0)
        self.assertEqual(
            result['answer'],
            "I couldn't find sufficient information to answer this question in the uploaded documents."
        )

    @patch('assistant.rag.GeminiRAGService._get_gemini_client')
    def test_mocked_gemini_answer_generation(self, mock_get_client):
        """Verifies Gemini generation pipeline attaches actual sources and formats correctly."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "The approved project budget is ₹2,50,000 according to campus records."
        mock_client.models.generate_content.return_value = mock_response
        mock_get_client.return_value = mock_client

        doc = Document.objects.create(
            original_filename="campus.txt",
            file_type="txt",
            file_size=100,
            status=Document.STATUS_INDEXED
        )
        c = DocumentChunk.objects.create(
            document=doc,
            chunk_index=0,
            text_content="Project budget: ₹2,50,000."
        )
        self.index_manager.index_document(doc.id, [c])

        result = self.rag_service.answer_question(
            query="What is the budget?",
            document_id=doc.id,
            session_key="test_session"
        )
        self.assertTrue(result['is_grounded'])
        self.assertEqual(result['answer'], "The approved project budget is ₹2,50,000 according to campus records.")
        self.assertEqual(len(result['sources']), 1)
        self.assertEqual(result['sources'][0]['filename'], "campus.txt")
        self.assertIn("₹2,50,000", result['sources'][0]['text_content'])


class EndpointAndViewsTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_index_page_loads(self):
        """Verifies GET / renders DocuMint workspace."""
        response = self.client.get(reverse('assistant:index'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "DocuMint")

    def test_invalid_upload_extension_rejected(self):
        """Verifies non-PDF/TXT files are rejected with 400 Bad Request."""
        bad_file = SimpleUploadedFile("malicious.exe", b"binary_data", content_type="application/octet-stream")
        response = self.client.post(reverse('assistant:upload_document'), {'file': bad_file})
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertFalse(data['success'])
        self.assertIn("Unsupported file format", data['error'])

    def test_ask_endpoint_empty_question_rejected(self):
        """Verifies empty question returns 400 Bad Request."""
        response = self.client.post(
            reverse('assistant:ask_question'),
            data='{"question": "  "}',
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertFalse(data['success'])

    def test_clear_chat_endpoint(self):
        """Verifies clearing chat removes session messages."""
        session = self.client.session
        session['init'] = True
        session.save()
        s_key = session.session_key

        ChatMessage.objects.create(session_key=s_key, role='user', content='Hello')
        ChatMessage.objects.create(session_key=s_key, role='assistant', content='Hi there')

        response = self.client.post(reverse('assistant:clear_chat'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ChatMessage.objects.filter(session_key=s_key).count(), 0)

    def test_compare_endpoint_requires_at_least_two_documents(self):
        """Verifies compare_documents_view rejects requests with fewer than 2 documents."""
        response = self.client.post(
            reverse('assistant:compare_documents'),
            data='{"query": "compare budget", "document_ids": [1]}',
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertFalse(data['success'])
        self.assertIn("at least two documents", data['error'])

    @patch('assistant.rag.GeminiRAGService._get_gemini_client')
    def test_evidence_mode_telemetry_and_meta(self, mock_get_client):
        """Verifies answer_question returns evidence_meta with tier and microsecond telemetry."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "The approved budget is ₹2,50,000."
        mock_client.models.generate_content.return_value = mock_response
        mock_get_client.return_value = mock_client

        temp_dir = tempfile.TemporaryDirectory()
        try:
            mgr = FAISSIndexManager(storage_dir=temp_dir.name)
            rag = GeminiRAGService(index_manager=mgr)

            doc = Document.objects.create(
                original_filename="budget_doc.txt",
                file_type="txt",
                file_size=100,
                status=Document.STATUS_INDEXED
            )
            c = DocumentChunk.objects.create(
                document=doc,
                chunk_index=0,
                char_start=0,
                char_end=45,
                text_content="Approved project budget is ₹2,50,000 for FY2026."
            )
            mgr.index_document(doc.id, [c])

            result = rag.answer_question(query="What is the budget?", document_id=doc.id)
            self.assertTrue(result['is_grounded'])
            self.assertIn('evidence_meta', result)
            self.assertIn(result['evidence_meta']['confidence_tier'], ['strong', 'moderate', 'borderline'])
            self.assertIn('telemetry', result)
            self.assertIn('retrieval_ms', result['telemetry'])
            self.assertIn('generation_ms', result['telemetry'])
            self.assertIn('total_ms', result['telemetry'])
            self.assertEqual(result['sources'][0]['char_start'], 0)
            self.assertEqual(result['sources'][0]['char_end'], 45)
        finally:
            temp_dir.cleanup()

    @patch('assistant.rag.GeminiRAGService._get_gemini_client')
    def test_cross_document_comparison(self, mock_get_client):
        """Verifies compare_documents returns structured comparison with evidence parity."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "Doc A specifies ₹2,50,000 while Doc B specifies ₹3,50,000."
        mock_client.models.generate_content.return_value = mock_response
        mock_get_client.return_value = mock_client

        temp_dir = tempfile.TemporaryDirectory()
        try:
            mgr = FAISSIndexManager(storage_dir=temp_dir.name)
            rag = GeminiRAGService(index_manager=mgr)

            doc_a = Document.objects.create(original_filename="doc_a.txt", file_type="txt", file_size=100, status=Document.STATUS_INDEXED)
            c_a = DocumentChunk.objects.create(document=doc_a, chunk_index=0, text_content="Approved budget is ₹2,50,000.")
            mgr.index_document(doc_a.id, [c_a])

            doc_b = Document.objects.create(original_filename="doc_b.txt", file_type="txt", file_size=100, status=Document.STATUS_INDEXED)
            c_b = DocumentChunk.objects.create(document=doc_b, chunk_index=0, text_content="Revised phase budget is ₹3,50,000.")
            mgr.index_document(doc_b.id, [c_b])

            res = rag.compare_documents(query="Compare budgets", document_ids=[doc_a.id, doc_b.id])
            self.assertTrue(res['success'])
            self.assertTrue(res['is_comparable'])
            self.assertEqual(len(res['document_summaries']), 2)
            self.assertGreaterEqual(len(res['evidence']), 2)
            self.assertIn('telemetry', res)
        finally:
            temp_dir.cleanup()


class EnterpriseAuthenticationTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_google_auth_default_instant(self):
        """Verifies 1-Click Google Sign-In creates/retrieves Google user in database with zero manual configuration."""
        response = self.client.post(
            reverse('assistant:google_auth'),
            data=json.dumps({}),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['success'])
        self.assertEqual(data['user']['email'], 'alex.morgan@gmail.com')
        self.assertEqual(data['user']['provider'], 'google')

        # Verify persisted in SQLite
        from django.contrib.auth.models import User
        from assistant.models import UserProfile
        user = User.objects.get(email='alex.morgan@gmail.com')
        self.assertEqual(user.profile.auth_provider, UserProfile.AUTH_GOOGLE)

        # Verify session is authenticated
        status_res = self.client.get(reverse('assistant:user_status'))
        self.assertTrue(status_res.json()['authenticated'])

    def test_google_auth_custom_profile(self):
        """Verifies 1-Click Google Sign-In with customized profile details."""
        payload = {
            'email': 'sarah.chen@documint.ai',
            'name': 'Dr. Sarah Chen',
            'avatar_url': 'https://example.com/avatar.jpg'
        }
        response = self.client.post(
            reverse('assistant:google_auth'),
            data=json.dumps(payload),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['success'])
        self.assertEqual(data['user']['name'], 'Dr. Sarah Chen')
        self.assertEqual(data['user']['avatar_url'], 'https://example.com/avatar.jpg')

    def test_evaluator_demo_login(self):
        """Verifies instant 1-Click Lead Evaluator access endpoint."""
        response = self.client.post(reverse('assistant:demo_login'))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['success'])
        self.assertEqual(data['user']['email'], 'evaluator@documint.ai')
        self.assertEqual(data['user']['provider'], 'demo')

    def test_register_login_logout_lifecycle(self):
        """Tests user registration, logout, and subsequent credential login."""
        # 1. Register new user
        reg_payload = {
            'full_name': 'Marcus Vance',
            'email': 'marcus.vance@company.com',
            'password': 'SecurePassword123!'
        }
        reg_res = self.client.post(
            reverse('assistant:register'),
            data=json.dumps(reg_payload),
            content_type='application/json'
        )
        self.assertEqual(reg_res.status_code, 201)
        self.assertTrue(reg_res.json()['success'])

        # 2. Check authenticated status
        status_res = self.client.get(reverse('assistant:user_status'))
        self.assertTrue(status_res.json()['authenticated'])
        self.assertEqual(status_res.json()['user']['email'], 'marcus.vance@company.com')

        # 3. Log out
        logout_res = self.client.post(reverse('assistant:logout'))
        self.assertEqual(logout_res.status_code, 200)

        status_after_logout = self.client.get(reverse('assistant:user_status'))
        self.assertFalse(status_after_logout.json()['authenticated'])

        # 4. Log in with email and password
        login_payload = {
            'identifier': 'marcus.vance@company.com',
            'password': 'SecurePassword123!'
        }
        login_res = self.client.post(
            reverse('assistant:login'),
            data=json.dumps(login_payload),
            content_type='application/json'
        )
        self.assertEqual(login_res.status_code, 200)
        self.assertTrue(login_res.json()['success'])

    def test_invalid_login_credentials(self):
        """Verifies failed login returns 401 with informative error."""
        res = self.client.post(
            reverse('assistant:login'),
            data=json.dumps({'identifier': 'nonexistent@company.com', 'password': 'wrongpassword'}),
            content_type='application/json'
        )
        self.assertEqual(res.status_code, 401)
        self.assertFalse(res.json()['success'])
        self.assertIn('Invalid credentials', res.json()['error'])

    def test_user_document_scoping(self):
        """Verifies multi-user document visibility and scoping."""
        from django.contrib.auth.models import User
        user_a = User.objects.create_user(username='user_a', email='a@documint.ai', password='password123')
        user_b = User.objects.create_user(username='user_b', email='b@documint.ai', password='password123')

        # Global document
        doc_global = Document.objects.create(original_filename="global_demo.txt", file_type="txt", file_size=100)
        # User A private document
        doc_a = Document.objects.create(user=user_a, original_filename="user_a_private.txt", file_type="txt", file_size=100)
        # User B private document
        doc_b = Document.objects.create(user=user_b, original_filename="user_b_private.txt", file_type="txt", file_size=100)

        # Anonymous user sees only global
        anon_res = self.client.get(reverse('assistant:list_documents'))
        anon_docs = [d['filename'] for d in anon_res.json()['documents']]
        self.assertIn("global_demo.txt", anon_docs)
        self.assertNotIn("user_a_private.txt", anon_docs)
        self.assertNotIn("user_b_private.txt", anon_docs)

        # User A logs in
        self.client.force_login(user_a)
        user_a_res = self.client.get(reverse('assistant:list_documents'))
        user_a_docs = [d['filename'] for d in user_a_res.json()['documents']]
        self.assertIn("global_demo.txt", user_a_docs)
        self.assertIn("user_a_private.txt", user_a_docs)
        self.assertNotIn("user_b_private.txt", user_a_docs)

        # User B logs in
        self.client.force_login(user_b)
        user_b_res = self.client.get(reverse('assistant:list_documents'))
        user_b_docs = [d['filename'] for d in user_b_res.json()['documents']]
        self.assertIn("global_demo.txt", user_b_docs)
        self.assertNotIn("user_a_private.txt", user_b_docs)
        self.assertIn("user_b_private.txt", user_b_docs)


