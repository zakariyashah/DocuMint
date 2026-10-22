import os
from django.db import models

from django.contrib.auth.models import User

class Document(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_PROCESSING = 'processing'
    STATUS_INDEXED = 'indexed'
    STATUS_ERROR = 'error'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_PROCESSING, 'Processing'),
        (STATUS_INDEXED, 'Indexed'),
        (STATUS_ERROR, 'Error'),
    ]

    FILE_TYPE_CHOICES = [
        ('pdf', 'PDF Document'),
        ('txt', 'Text Document'),
    ]

    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='documents')
    file = models.FileField(upload_to='uploads/%Y/%m/%d/')
    original_filename = models.CharField(max_length=255)
    file_type = models.CharField(max_length=10, choices=FILE_TYPE_CHOICES)
    file_size = models.PositiveIntegerField(help_text="File size in bytes")
    page_count = models.PositiveIntegerField(default=1)
    total_chunks = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default=STATUS_PENDING)
    error_message = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.original_filename} ({self.status})"

    def delete(self, *args, **kwargs):
        # Clean up file on disk when document record is deleted
        if self.file and os.path.isfile(self.file.path):
            try:
                os.remove(self.file.path)
            except OSError:
                pass
        super().delete(*args, **kwargs)


class DocumentChunk(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='chunks')
    chunk_index = models.PositiveIntegerField()
    page_number = models.PositiveIntegerField(null=True, blank=True, help_text="1-based page number for PDF")
    text_content = models.TextField()
    char_start = models.PositiveIntegerField(default=0)
    char_end = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['document', 'chunk_index']
        indexes = [
            models.Index(fields=['document', 'chunk_index']),
        ]

    def __str__(self):
        page_info = f"p.{self.page_number}" if self.page_number else "txt"
        return f"Doc {self.document_id} Chunk {self.chunk_index} ({page_info})"


class ChatMessage(models.Model):
    ROLE_CHOICES = [
        ('user', 'User'),
        ('assistant', 'Assistant'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True, related_name='chat_messages')
    session_key = models.CharField(max_length=100, db_index=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    content = models.TextField()
    sources_json = models.JSONField(blank=True, default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"[{self.role}] {self.content[:40]}..."


class UserProfile(models.Model):
    AUTH_LOCAL = 'local'
    AUTH_GOOGLE = 'google'
    AUTH_DEMO = 'demo'

    AUTH_PROVIDER_CHOICES = [
        (AUTH_LOCAL, 'Email & Password'),
        (AUTH_GOOGLE, 'Google Workspace'),
        (AUTH_DEMO, 'Evaluator Demo Account'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    display_name = models.CharField(max_length=150, blank=True, default='')
    avatar_url = models.CharField(max_length=500, blank=True, default='')
    auth_provider = models.CharField(max_length=50, choices=AUTH_PROVIDER_CHOICES, default=AUTH_LOCAL)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} ({self.auth_provider})"
