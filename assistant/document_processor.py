import os
import re
try:
    import pymupdf as fitz
except ImportError:
    import fitz
from django.db import transaction
from .models import Document, DocumentChunk

class DocumentProcessingError(Exception):
    """Custom exception raised during document extraction and chunking."""
    pass


def split_text_into_chunks(text: str, chunk_size: int = 900, overlap: int = 150) -> list[dict]:
    """
    Divides text into overlapping chunks of approximately 800-1000 characters.
    Attempts natural boundary splits (newlines, periods, spaces) to prevent cutting words.
    Returns list of dicts: [{'text': str, 'char_start': int, 'char_end': int}]
    """
    clean_text = text.strip()
    if not clean_text:
        return []

    # If document/page text is already small enough, return as single chunk
    if len(clean_text) <= chunk_size:
        return [{'text': clean_text, 'char_start': 0, 'char_end': len(clean_text)}]

    chunks = []
    start = 0
    text_len = len(clean_text)

    while start < text_len:
        end = min(start + chunk_size, text_len)

        # If not at the end of the text, look for natural punctuation or word breaks
        if end < text_len:
            # Look for paragraph break, period, question mark, exclamation, or newline in the last 150 chars
            search_window = clean_text[max(start, end - 150):end]
            match = None
            for delim in ['\n\n', '.\n', '.\r\n', '. ', '? ', '! ', '\n', ' ']:
                idx = search_window.rfind(delim)
                if idx != -1:
                    match = max(start, end - 150) + idx + len(delim)
                    break
            if match and match > start + 200:
                end = match

        chunk_snippet = clean_text[start:end].strip()
        if chunk_snippet:
            chunks.append({
                'text': chunk_snippet,
                'char_start': start,
                'char_end': end
            })

        if end >= text_len:
            break

        # Move forward, maintaining overlap
        start = max(start + 1, end - overlap)

    return chunks


def process_uploaded_document(document: Document) -> list[DocumentChunk]:
    """
    Extracts text from an uploaded PDF or TXT file, chunks the content with metadata,
    and stores chunks in the SQLite database.
    """
    if not document.file or not os.path.exists(document.file.path):
        raise DocumentProcessingError(f"File for document '{document.original_filename}' does not exist on disk.")

    file_path = document.file.path
    file_type = document.file_type.lower()
    raw_chunks_data = []  # list of tuples: (text, page_number, char_start, char_end)
    detected_page_count = 1

    try:
        if file_type == 'pdf':
            try:
                doc = fitz.open(file_path)
            except Exception as e:
                raise DocumentProcessingError(f"Corrupt or invalid PDF file: {str(e)}")

            detected_page_count = len(doc)
            if detected_page_count == 0:
                raise DocumentProcessingError("The uploaded PDF file contains 0 pages.")

            total_extracted_text = ""
            for page_idx in range(detected_page_count):
                page = doc[page_idx]
                page_num = page_idx + 1  # 1-based page numbering
                page_text = page.get_text("text").strip()
                if page_text:
                    total_extracted_text += page_text + "\n"
                    page_chunks = split_text_into_chunks(page_text, chunk_size=900, overlap=150)
                    for pc in page_chunks:
                        raw_chunks_data.append((pc['text'], page_num, pc['char_start'], pc['char_end']))

            doc.close()

            if not total_extracted_text.strip():
                raise DocumentProcessingError(
                    "The uploaded PDF contains no extractable digital text. "
                    "Scanned documents or image-based PDFs require Optical Character Recognition (OCR), "
                    "which is outside this implementation."
                )

        elif file_type == 'txt':
            detected_page_count = 1
            encodings = ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252', 'iso-8859-1']
            raw_bytes = None
            with open(file_path, 'rb') as f:
                raw_bytes = f.read()

            if not raw_bytes or not raw_bytes.strip():
                raise DocumentProcessingError("The uploaded text document is empty or contains only whitespace.")

            decoded_text = None
            for enc in encodings:
                try:
                    decoded_text = raw_bytes.decode(enc)
                    break
                except UnicodeDecodeError:
                    continue

            if decoded_text is None:
                decoded_text = raw_bytes.decode('utf-8', errors='replace')

            clean_text = decoded_text.strip()
            if not clean_text:
                raise DocumentProcessingError("The uploaded text document is empty or contains only whitespace.")

            txt_chunks = split_text_into_chunks(clean_text, chunk_size=900, overlap=150)
            for tc in txt_chunks:
                raw_chunks_data.append((tc['text'], None, tc['char_start'], tc['char_end']))

        else:
            raise DocumentProcessingError(f"Unsupported file type '{file_type}'. Only PDF and TXT are supported.")

        if not raw_chunks_data:
            raise DocumentProcessingError("No readable text chunks could be generated from the document.")

        # Save chunks in database within a transaction
        created_chunks = []
        with transaction.atomic():
            # Delete existing chunks if re-processing
            document.chunks.all().delete()

            chunk_objects = [
                DocumentChunk(
                    document=document,
                    chunk_index=idx,
                    page_number=page_num,
                    text_content=text,
                    char_start=c_start,
                    char_end=c_end
                )
                for idx, (text, page_num, c_start, c_end) in enumerate(raw_chunks_data)
            ]
            created_chunks = DocumentChunk.objects.bulk_create(chunk_objects)

            document.page_count = detected_page_count
            document.total_chunks = len(created_chunks)
            document.status = Document.STATUS_INDEXED
            document.error_message = ''
            document.save()

        return created_chunks

    except DocumentProcessingError as e:
        document.status = Document.STATUS_ERROR
        document.error_message = str(e)
        document.save()
        raise
    except Exception as e:
        err_msg = f"Unexpected processing error: {str(e)}"
        document.status = Document.STATUS_ERROR
        document.error_message = err_msg
        document.save()
        raise DocumentProcessingError(err_msg)
