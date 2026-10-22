"""
DocuMint ASGI Shim. Delegates to config.asgi.application.
"""
from config.asgi import application

__all__ = ['application']
