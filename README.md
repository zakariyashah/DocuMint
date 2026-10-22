# DocuMint — AI-Powered Document Intelligence Assistant

> **Understand Your Documents. Find Answers with Evidence.**

DocuMint is an enterprise-grade document research and intelligence workspace built with **Django**, **Sentence Transformers**, **FAISS**, and **Google Gemini**. It enables users to upload PDF and TXT documents, perform natural-language semantic research, and receive grounded answers supported by verifiable citations and exact PDF page numbers.

---

## 1. System Architecture

DocuMint implements strict, un-compromised **Retrieval-Augmented Generation (RAG)**:

```
[ User Upload (PDF / TXT) ]
         │
         ▼
[ Text Extraction (PyMuPDF / UTF-8 Decoding) ]
         │
         ▼
[ Overlapping Chunking (~900 chars, 150 char overlap) ]
         │
         ▼
[ Normalized Embeddings (all-MiniLM-L6-v2, 384-dim) ]
         │
         ▼
[ FAISS Vector Index (IndexFlatIP — Cosine Similarity) ]
         │
         ▼
[ User Question ] ──► [ Semantic Similarity Search (Top-K) ]
                               │
                               ▼
               [ Relevance Threshold Check (≥ 0.35) ]
                    /                     \
       (Below Threshold)            (Exceeds Threshold)
              │                              │
              ▼                              ▼
     [ Grounded Refusal ]          [ Grounded Gemini Synthesis ]
  "Insufficient evidence in          Strict Context + Citations
     uploaded documents"
```

### Why this design?
1. **Deterministic Grounding:** If semantic similarity falls below the relevance threshold (e.g. asking *"Who is the chief minister of Japan?"* against a campus facilities document), DocuMint halts execution and refuses to query the LLM. This eliminates hallucination at the architectural boundary.
2. **SQLite as Single Source of Truth:** Extracted chunks and document metadata are stored in SQLite via Django ORM. The FAISS vector store is a fast, rebuildable search index mapped directly to SQLite database chunk IDs.
3. **Zero Cross-Document Leakage:** Each document's index is isolated. When querying a specific document, retrieval is mathematically restricted to that document's vector space.
4. **Stale Vector Elimination:** Deleting a document immediately unlinks its physical file, deletes its SQLite records, and purges its FAISS index file.

---

## 2. Requirements Compliance Verification

| Requirement | Implementation Details | Status |
|---|---|:---:|
| **1. Document Upload** | Server-validated PDF & TXT file upload with 10 MB size limits, safe internal filenames, and MIME validation in `assistant/forms.py`. | **VERIFIED** |
| **2. Document Processing** | PyMuPDF text extraction preserving PDF page numbers; safe TXT multi-encoding decoding (`utf-8`, `latin-1`, `cp1252`); empty document & scanned/OCR detection in `assistant/document_processor.py`. | **VERIFIED** |
| **3. Chunking & Overlap** | Sliding window text chunking (~900 characters per chunk, 150 character overlap) breaking on sentence/word boundaries with character offsets in `assistant/document_processor.py`. | **VERIFIED** |
| **4. Real Semantic RAG** | `sentence-transformers/all-MiniLM-L6-v2` generating 384-dimensional normalized vector embeddings with `faiss-cpu` `IndexFlatIP` (Cosine Similarity) in `assistant/rag.py`. | **VERIFIED** |
| **5. Gemini Generative AI** | Official `google-genai` Python SDK (`client.models.generate_content`) utilizing `gemini-3.8-flash` with strict anti-injection and grounding system instructions. | **VERIFIED** |
| **6. Source Citations & Scores** | Every answer returns filename, 1-based PDF page numbers (or TXT identifier), chunk index, similarity score, and excerpt inspection modal. | **VERIFIED** |
| **7. Grounded Refusals** | Calibrated cosine similarity threshold (0.35). Returns clear refusal when evidence is missing without invoking the LLM. | **VERIFIED** |
| **8. Document Isolation** | Per-document FAISS index scoping preventing vector leakage between unrelated documents. | **VERIFIED** |
| **9. Document Summarization** | Executive summarization feature with staged chunk sampling, key takeaways, numerical data, and disclosures in `assistant/rag.py`. | **VERIFIED** |
| **10. Deletion & Stale Index Cleanup** | Atomic deletion of SQLite records, disk files, and vector index files. | **VERIFIED** |
| **11. Enterprise UI Design** | Restrained palette (`#14243A`, `#26364A`, `#167D82`, `#F5F7FA`), responsive 3-column workspace, Bootstrap 5, and vanilla JS. | **VERIFIED** |
| **12. Automated Test Suite** | 14 automated Django test cases covering chunking, PDF extraction, FAISS retrieval, document isolation, refusals, and deletion in `assistant/tests.py`. | **VERIFIED** |

---

## 3. Quickstart Guide (Windows PowerShell)

Follow these exact commands in Windows PowerShell:

### Step 1: Clone or Navigate to Workspace
```powershell
cd c:\Users\thero\OneDrive\Desktop\DocuMint
```

### Step 2: Create and Activate Virtual Environment
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### Step 3: Install Required Dependencies
```powershell
pip install -r requirements.txt
```

### Step 4: Configure Environment Variables
Copy `.env.example` to `.env`:
```powershell
Copy-Item .env.example .env
```
Open `.env` in your text editor and add your Google Gemini API key:
```ini
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash
```
*(Note: If you do not have an API key right away, DocuMint will still run semantic vector retrieval and display the exact retrieved passages with similarity scores!)*

### Step 5: Run Database Migrations
```powershell
python manage.py migrate
```

### Step 6: Start Development Server
```powershell
python manage.py runserver 127.0.0.1:8000
```

### Step 7: Access Application
Open your browser and navigate to:
```
http://127.0.0.1:8000/
```

### Step 8: Run Automated Test Suite
To verify the entire RAG pipeline and edge cases:
```powershell
python manage.py test
```

---

## 4. Hackathon Demonstration Sequence

DocuMint includes sample test documents in `sample_data/`:

### Demo Walkthrough:
1. **Upload Sample Document:**
   - In the left sidebar, click **Upload Document** and select `sample_data/demo_document.txt`.
   - Watch the status badge transition to **Indexed** (`2 chunks`).
2. **Query Budget Allocation:**
   - Click the prompt chip: *"What is the project budget?"*
   - Observe the retrieved evidence in the right panel showing:
     - Document: `demo_document.txt`
     - Score: `~0.56` (Cosine similarity)
     - Text passage: `Project Budget: ₹2,50,000.`
3. **Query Firm Deadline:**
   - Ask: *"What is the project deadline?"*
   - Verify the citation: `15 December 2026`.
4. **Test Hallucination Refusal:**
   - Ask: *"Who is the chief minister of Japan?"*
   - Observe the immediate response:
     > *"I couldn't find sufficient information to answer this question in the uploaded documents."*
     Notice that retrieval count is `0` and no irrelevant chunks were passed.
5. **Test Multi-Page PDF & Page Citations:**
   - Upload `sample_data/demo_document.pdf`.
   - Ask: *"What was the precision and budget of the benchmark cluster?"*
   - Inspect the citation badge: observe that it specifies **Page 2**, exactly where that fact is located!
6. **Test Document Scope Isolation:**
   - In the **Retrieval Scope** dropdown, switch from *All Documents* to `demo_document.pdf`.
   - Ask: *"What is Aisha Khan's project?"*
   - Notice that DocuMint refuses to answer because Aisha Khan exists only in `demo_document.txt`, proving zero cross-document vector leakage.
7. **Test Document Summarization:**
   - Click the three-dots menu next to `demo_document.pdf` and select **Summarize Document**.
   - Review the structured executive summary modal with key takeaways and conclusions.
8. **Test Safe Document Deletion:**
   - Delete `demo_document.txt`.
   - Query again for *"₹2,50,000"* and observe that the chunk is completely gone and never returns stale data.

---

## 5. Technology Stack Summary

- **Backend Framework:** Django 6 (Python 3.13)
- **Database:** SQLite (Django ORM as Authoritative Source of Truth)
- **Vector Search Engine:** FAISS CPU (`IndexFlatIP`)
- **Semantic Embeddings:** Sentence Transformers (`all-MiniLM-L6-v2`, 384 dimensions, normalized)
- **Generative AI:** Google Gemini (`gemini-3.8-flash` via official `google-genai` SDK)
- **PDF Extraction:** PyMuPDF (`pymupdf`)
- **Frontend:** HTML5, CSS3 Custom Properties, Bootstrap 5.3, Bootstrap Icons, Vanilla JavaScript

---

## 6. Troubleshooting & FAQ

- **Q: Model download takes time on first run?**
  *A:* On the very first search or document upload, `sentence-transformers` automatically downloads the compact 80MB `all-MiniLM-L6-v2` model weights to `~/.cache/huggingface/hub/`. Subsequent executions load instantly from cache.
- **Q: Scanned PDFs show an error?**
  *A:* DocuMint automatically detects image-only or scanned PDFs that contain zero extractable text streams and alerts the user that OCR (Optical Character Recognition) is required.
- **Q: How are similarity scores calculated?**
  *A:* Both chunk text and user queries are embedded into 384-dimensional unit vectors ($L_2$-normalized). The FAISS `IndexFlatIP` computes the inner product, which is mathematically identical to cosine similarity: $\cos(\theta) = \frac{u \cdot v}{\|u\| \|v\|} = u \cdot v \in [-1, 1]$. Chunks scoring below the threshold (default `0.35`) are excluded from generation.
