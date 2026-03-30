package com.agenteia.internalchat.ui

import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.agenteia.internalchat.R
import com.agenteia.internalchat.data.MessageDto
import com.agenteia.internalchat.data.SendMessageRequest
import com.agenteia.internalchat.data.SessionStore
import com.agenteia.internalchat.data.UploadImageAttachmentRequest
import com.agenteia.internalchat.network.ApiClient
import com.agenteia.internalchat.network.InternalChatSocketClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.Response

class ChatActivity : AppCompatActivity() {
    private data class PendingImageAttachment(
        val originalName: String,
        val mimeType: String,
        val contentBase64: String,
        val previewUri: Uri,
    )

    private lateinit var sessionStore: SessionStore
    private lateinit var adapter: MessagesAdapter
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var statusText: TextView
    private lateinit var titleText: TextView
    private lateinit var input: EditText
    private lateinit var sendButton: ImageButton
    private lateinit var emojiButton: ImageButton
    private lateinit var attachButton: ImageButton
    private lateinit var attachmentPreview: View
    private lateinit var attachmentImage: ImageView
    private lateinit var attachmentName: TextView
    private lateinit var attachmentClearButton: Button
    private lateinit var recyclerView: RecyclerView
    private lateinit var conversationId: String
    private lateinit var socketClient: InternalChatSocketClient
    private lateinit var layoutManager: LinearLayoutManager
    private var pendingImage: PendingImageAttachment? = null

    private val imagePicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            prepareImageAttachment(uri)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_chat)
        WindowInsetsHelper.applySystemBarsPadding(findViewById<View>(R.id.chatRoot), includeImeBottom = true)

        sessionStore = SessionStore(this)
        socketClient = InternalChatSocketClient(this)
        conversationId = intent.getStringExtra("conversationId").orEmpty()
        val conversationName = intent.getStringExtra("conversationName") ?: getString(R.string.chat_title)
        title = conversationName

        swipeRefresh = findViewById(R.id.chatRefresh)
        titleText = findViewById(R.id.chatConversationTitle)
        statusText = findViewById(R.id.chatStatusText)
        input = findViewById(R.id.chatInput)
        sendButton = findViewById(R.id.chatSendButton)
        emojiButton = findViewById(R.id.chatEmojiButton)
        attachButton = findViewById(R.id.chatAttachButton)
        attachmentPreview = findViewById(R.id.chatAttachmentPreview)
        attachmentImage = findViewById(R.id.chatAttachmentImage)
        attachmentName = findViewById(R.id.chatAttachmentName)
        attachmentClearButton = findViewById(R.id.chatAttachmentClearButton)
        recyclerView = findViewById(R.id.chatRecycler)
        titleText.text = conversationName

        layoutManager = LinearLayoutManager(this)
        adapter = MessagesAdapter(sessionStore.getUserId()) { message ->
            confirmDeleteMessage(message)
        }
        recyclerView.layoutManager = layoutManager
        recyclerView.adapter = adapter

        swipeRefresh.setOnRefreshListener { loadMessages() }
        sendButton.setOnClickListener { sendMessage() }
        emojiButton.setOnClickListener {
            input.append("👍")
        }
        attachButton.setOnClickListener {
            imagePicker.launch("image/*")
        }
        attachmentClearButton.setOnClickListener {
            clearPendingImage()
        }
    }

    override fun onResume() {
        super.onResume()
        connectSocket()
        loadMessages(scrollToBottom = true)
    }

    override fun onPause() {
        socketClient.disconnect()
        super.onPause()
    }

    private fun connectSocket() {
        socketClient.connect(sessionStore.getUserId()) { event ->
            if (event.conversationId != conversationId) return@connect
            runOnUiThread {
                val shouldScroll = isNearBottom() || event.senderUserId == sessionStore.getUserId()
                loadMessages(scrollToBottom = shouldScroll)
            }
        }
    }

    private fun authorization(): String = "Bearer ${sessionStore.getToken()}"

    private fun isNearBottom(): Boolean {
        val lastVisible = layoutManager.findLastVisibleItemPosition()
        return lastVisible == RecyclerView.NO_POSITION || lastVisible >= adapter.itemCount - 3
    }

    private fun extractErrorMessage(response: Response<*>?, fallbackResId: Int): String {
        val fallback = getString(fallbackResId)
        if (response == null) return fallback
        val errorText = runCatching { response.errorBody()?.string() }.getOrNull().orEmpty().trim()
        if (errorText.isNotBlank()) return errorText
        return fallback
    }

    private fun prepareImageAttachment(uri: Uri) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val resolver = applicationContext.contentResolver
                val mimeType = resolver.getType(uri).orEmpty().ifBlank { "image/jpeg" }
                val allowed = setOf("image/jpeg", "image/png", "image/webp")
                if (!allowed.contains(mimeType)) {
                    throw IllegalArgumentException(getString(R.string.image_type_not_supported))
                }
                val inputStream = resolver.openInputStream(uri)
                    ?: throw IllegalArgumentException(getString(R.string.image_read_failed))
                val bytes = inputStream.use { it.readBytes() }
                if (bytes.isEmpty()) {
                    throw IllegalArgumentException(getString(R.string.image_read_failed))
                }
                val name = resolver.query(uri, null, null, null, null)?.use { cursor ->
                    val index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
                } ?: "imagen"
                val dataUrl = "data:$mimeType;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}"
                val next = PendingImageAttachment(
                    originalName = name,
                    mimeType = mimeType,
                    contentBase64 = dataUrl,
                    previewUri = uri,
                )
                withContext(Dispatchers.Main) {
                    pendingImage = next
                    attachmentPreview.visibility = View.VISIBLE
                    attachmentImage.setImageURI(uri)
                    attachmentName.text = name
                    statusText.text = ""
                }
            } catch (error: Exception) {
                withContext(Dispatchers.Main) {
                    statusText.text = error.message ?: getString(R.string.image_read_failed)
                }
            }
        }
    }

    private fun clearPendingImage() {
        pendingImage = null
        attachmentPreview.visibility = View.GONE
        attachmentImage.setImageDrawable(null)
        attachmentName.text = ""
    }

    private fun loadMessages(scrollToBottom: Boolean = false) {
        swipeRefresh.isRefreshing = true
        CoroutineScope(Dispatchers.IO).launch {
            val response = runCatching {
                ApiClient.api(this@ChatActivity).getConversationMessages(authorization(), conversationId)
            }.getOrNull()
            withContext(Dispatchers.Main) {
                swipeRefresh.isRefreshing = false
                if (response == null || !response.isSuccessful) {
                    statusText.text = extractErrorMessage(response, R.string.load_messages_failed)
                    return@withContext
                }
                val body = response.body()
                if (body?.ok != true) {
                    statusText.text = body?.message ?: getString(R.string.load_messages_failed)
                    return@withContext
                }
                adapter.submit(body.messages)
                if (scrollToBottom && body.messages.isNotEmpty()) {
                    recyclerView.scrollToPosition(body.messages.size - 1)
                }
                statusText.text = ""
            }
        }
    }

    private fun confirmDeleteMessage(message: MessageDto) {
        AlertDialog.Builder(this)
            .setTitle(R.string.delete_message_title)
            .setMessage(R.string.delete_message_description)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.delete) { _, _ ->
                deleteMessage(message)
            }
            .show()
    }

    private fun deleteMessage(message: MessageDto) {
        CoroutineScope(Dispatchers.IO).launch {
            val response = runCatching {
                ApiClient.api(this@ChatActivity).deleteMessagePost(authorization(), conversationId, message.id)
            }.getOrNull()
            withContext(Dispatchers.Main) {
                if (response == null || !response.isSuccessful || response.body()?.ok != true) {
                    statusText.text = response?.body()?.message ?: extractErrorMessage(response, R.string.delete_message_failed)
                    return@withContext
                }
                loadMessages(scrollToBottom = false)
            }
        }
    }

    private fun sendMessage() {
        val text = input.text.toString().trim()
        val image = pendingImage
        if (text.isBlank() && image == null) return
        sendButton.isEnabled = false
        attachButton.isEnabled = false

        CoroutineScope(Dispatchers.IO).launch {
            val response = runCatching {
                ApiClient.api(this@ChatActivity).sendMessage(
                    authorization(),
                    conversationId,
                    SendMessageRequest(
                        text = text,
                        attachment = image?.let {
                            UploadImageAttachmentRequest(
                                originalName = it.originalName,
                                mimeType = it.mimeType,
                                contentBase64 = it.contentBase64,
                            )
                        }
                    )
                )
            }.getOrNull()
            withContext(Dispatchers.Main) {
                sendButton.isEnabled = true
                attachButton.isEnabled = true
                if (response == null || !response.isSuccessful || response.body()?.ok != true) {
                    statusText.text = response?.body()?.error ?: extractErrorMessage(response, R.string.send_message_failed)
                    return@withContext
                }
                input.setText("")
                clearPendingImage()
                loadMessages(scrollToBottom = true)
            }
        }
    }
}

