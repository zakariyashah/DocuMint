import os
import threading
import logging
from django.apps import AppConfig

logger = logging.getLogger(__name__)

class AssistantConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'assistant'
    verbose_name = 'DocuMint Document Assistant'

    def ready(self):
        # Only run in main process, not during migrations or reload loops
        if os.environ.get('RUN_MAIN') == 'true' or not os.environ.get('DJANGO_SETTINGS_MODULE'):
            def _warmup():
                try:
                    logger.info("DocuMint: Pre-warming AI embedding model in background...")
                    from .rag import get_embedding_model
                    get_embedding_model()
                    logger.info("DocuMint: AI embedding model successfully warmed and ready in memory.")
                except Exception as e:
                    logger.warning(f"DocuMint: Embedding model background warm-up deferred: {e}")

            warmup_thread = threading.Thread(target=_warmup, daemon=True, name="DocuMintWarmup")
            warmup_thread.start()
