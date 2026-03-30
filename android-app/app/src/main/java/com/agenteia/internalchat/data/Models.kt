package com.agenteia.internalchat.data

data class LoginRequest(
    val email: String,
    val password: String,
    val deviceName: String
)

data class UserDto(
    val id: String,
    val name: String = "",
    val email: String
)

data class LoginResponse(
    val ok: Boolean,
    val token: String?,
    val user: UserDto?,
    val message: String?
)

data class MeResponse(
    val ok: Boolean,
    val user: UserDto?,
    val fcmConfigured: Boolean = false,
    val message: String? = null
)

data class ConversationDto(
    val id: String,
    val participantUserIds: List<String> = emptyList(),
    val counterpartUserId: String = "",
    val counterpartEmail: String = "",
    val lastMessageAt: String? = null,
    val lastMessageText: String = "",
    val unreadCount: Int = 0
)

data class ConversationsResponse(
    val ok: Boolean,
    val conversations: List<ConversationDto> = emptyList(),
    val message: String? = null
)

data class MessageAttachmentDto(
    val type: String,
    val fileId: String,
    val mimeType: String = "",
    val originalName: String = "",
    val relativePath: String = "",
    val url: String = ""
)

data class MessageDto(
    val id: String,
    val conversationId: String,
    val senderUserId: String,
    val senderName: String = "",
    val recipientUserId: String,
    val text: String,
    val timestamp: String,
    val conversationType: String = "direct",
    val readAt: String? = null,
    val attachment: MessageAttachmentDto? = null
)

data class MessagesResponse(
    val ok: Boolean,
    val conversation: ConversationDto?,
    val messages: List<MessageDto> = emptyList(),
    val message: String? = null
)

data class UploadImageAttachmentRequest(
    val originalName: String,
    val mimeType: String,
    val contentBase64: String
)

data class SendMessageRequest(
    val text: String,
    val attachment: UploadImageAttachmentRequest? = null
)

data class SendMessageResponse(
    val ok: Boolean,
    val message: MessageDto?,
    val error: String? = null
)

data class DeviceTokenRequest(
    val token: String,
    val deviceName: String,
    val appVersion: String
)

data class GenericResponse(
    val ok: Boolean,
    val message: String? = null,
    val deletedCount: Int? = null
)

data class RealtimeMessageEvent(
    val messageId: String,
    val conversationId: String,
    val senderUserId: String,
    val senderName: String = "",
    val recipientUserId: String,
    val text: String,
    val timestamp: String,
    val conversationType: String = "direct",
    val readAt: String? = null,
    val attachment: MessageAttachmentDto? = null
)

