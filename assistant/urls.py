from django.urls import path
from . import views

app_name = 'assistant'

urlpatterns = [
    path('', views.index_view, name='index'),
    path('api/documents/', views.list_documents_view, name='list_documents'),
    path('api/documents/upload/', views.upload_document_view, name='upload_document'),
    path('api/documents/<int:document_id>/status/', views.document_status_view, name='document_status'),
    path('api/documents/<int:document_id>/summarize/', views.summarize_document_view, name='summarize_document'),
    path('api/documents/<int:document_id>/delete/', views.delete_document_view, name='delete_document'),
    path('api/documents/compare/', views.compare_documents_view, name='compare_documents'),
    path('api/chat/ask/', views.ask_question_view, name='ask_question'),
    path('api/chat/clear/', views.clear_chat_view, name='clear_chat'),
    path('api/chat/history/', views.get_chat_history_view, name='chat_history'),
    path('api/sources/<int:chunk_id>/', views.get_source_detail_view, name='source_detail'),
    # Enterprise Identity & Authentication Routes
    path('api/auth/login/', views.login_view, name='login'),
    path('api/auth/register/', views.register_view, name='register'),
    path('api/auth/google/', views.google_auth_view, name='google_auth'),
    path('api/auth/demo/', views.demo_login_view, name='demo_login'),
    path('api/auth/logout/', views.logout_view, name='logout'),
    path('api/auth/status/', views.user_status_view, name='user_status'),
]
