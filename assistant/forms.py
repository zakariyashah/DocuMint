import os
from django import forms
from django.conf import settings
from django.core.exceptions import ValidationError

class DocumentUploadForm(forms.Form):
    file = forms.FileField(required=True)

    def clean_file(self):
        uploaded_file = self.cleaned_data.get('file')
        if not uploaded_file:
            raise ValidationError("No file was provided.")

        # Validate file size
        max_size_mb = getattr(settings, 'MAX_UPLOAD_SIZE_MB', 10)
        max_size_bytes = max_size_mb * 1024 * 1024
        if uploaded_file.size > max_size_bytes:
            raise ValidationError(
                f"File size exceeds the {max_size_mb} MB limit. "
                f"Your file is {uploaded_file.size / (1024 * 1024):.2f} MB."
            )

        # Validate file extension
        ext = os.path.splitext(uploaded_file.name)[1].lower()
        allowed_exts = getattr(settings, 'ALLOWED_UPLOAD_EXTENSIONS', ['.pdf', '.txt'])
        if ext not in allowed_exts:
            raise ValidationError(
                f"Unsupported file format '{ext}'. Only {', '.join(allowed_exts).upper()} files are permitted."
            )

        # Basic path traversal protection
        base_name = os.path.basename(uploaded_file.name)
        if not base_name or '..' in base_name:
            raise ValidationError("Invalid filename detected.")

        return uploaded_file
