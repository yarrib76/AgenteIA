package com.agenteia.internalchat.network

import android.content.Context
import com.agenteia.internalchat.data.MessageAttachmentDto
import com.agenteia.internalchat.data.RealtimeMessageEvent
import com.agenteia.internalchat.data.ServerSettingsStore
import io.socket.client.IO
import io.socket.client.Socket
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import org.json.JSONObject
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    private fun build(baseUrl: String): ApiService {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        val client = OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .build()

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }

    fun api(context: Context): ApiService {
        val baseUrl = ServerSettingsStore(context.applicationContext).getBackendBaseUrl()
        return build(baseUrl)
    }

    fun resolveUrl(context: Context, value: String): String {
        val raw = value.trim()
        if (raw.isBlank()) return ""
        if (raw.startsWith("http://") || raw.startsWith("https://")) return raw
        val baseUrl = ServerSettingsStore(context.applicationContext).getBackendBaseUrl().removeSuffix("/")
        return "$baseUrl/${raw.trimStart('/')}"
    }
}

class InternalChatSocketClient(private val context: Context) {
    private var socket: Socket? = null

    fun connect(userId: String, onMessage: (RealtimeMessageEvent) -> Unit) {
        disconnect()
        val baseUrl = ServerSettingsStore(context.applicationContext).getBackendBaseUrl().removeSuffix("/")
        val options = IO.Options.builder()
            .setForceNew(true)
            .setReconnection(true)
            .build()
        socket = IO.socket(baseUrl, options)
        socket?.on(Socket.EVENT_CONNECT) {
            val payload = JSONObject().put("userId", userId)
            socket?.emit("internal-chat-auth", payload)
        }
        socket?.on("internal-chat-message") { args ->
            val raw = args.firstOrNull() as? JSONObject ?: return@on
            val attachmentRaw = raw.optJSONObject("attachment")
            val attachment = attachmentRaw?.let {
                MessageAttachmentDto(
                    type = it.optString("type"),
                    fileId = it.optString("fileId"),
                    mimeType = it.optString("mimeType"),
                    originalName = it.optString("originalName"),
                    relativePath = it.optString("relativePath"),
                    url = it.optString("url"),
                )
            }
            val event = RealtimeMessageEvent(
                messageId = raw.optString("messageId"),
                conversationId = raw.optString("conversationId"),
                senderUserId = raw.optString("senderUserId"),
                senderName = raw.optString("senderName"),
                recipientUserId = raw.optString("recipientUserId"),
                text = raw.optString("text"),
                timestamp = raw.optString("timestamp"),
                conversationType = raw.optString("conversationType").ifBlank { "direct" },
                readAt = raw.optString("readAt").ifBlank { null },
                attachment = attachment,
            )
            onMessage(event)
        }
        socket?.connect()
    }

    fun disconnect() {
        socket?.off()
        socket?.disconnect()
        socket = null
    }
}

