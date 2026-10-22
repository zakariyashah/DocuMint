"""
DocuMint WSGI Shim for Render / Heroku / Gunicorn default discovery.
Delegates to config.wsgi.application.
"""
import os
from config.wsgi import application

__all__ = ['application']
