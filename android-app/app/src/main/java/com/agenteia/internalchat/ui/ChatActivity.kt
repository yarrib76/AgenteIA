package com.agenteia.internalchat.ui

import android.os.Bundle
import android.view.View
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.agenteia.internalchat.R
import com.agenteia.internalchat.data.MessageDto
import com.agenteia.internalchat.data.SendMessageRequest
import com.agenteia.internalchat.data.SessionStore
import com.agenteia.internalchat.network.ApiClient
import com.agenteia.internalchat.network.InternalChatSocketClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.Response

class ChatActivity : AppCompatActivity() {
    private lateinit var sessionStore: SessionStore
    private lateinit var adapter: MessagesAdapter
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var statusText: TextView
    private lateinit var input: EditText
    private lateinit var sendButton: ImageButton
    private lateinit var emojiButton: ImageButton
    private lateinit var emojiScroll: HorizontalScrollView
    private lateinit var recyclerView: RecyclerView
    private lateinit var conversationId: String
    private lateinit var socketClient: InternalChatSocketClient
    private lateinit var layoutManager: LinearLayoutManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_chat)

        sessionStore = SessionStore(this)
        socketClient = InternalChatSocketClient(this)
        conversationId = intent.getStringExtra("conversationId").orEmpty()
        title = intent.getStringExtra("conversationName") ?: getString(R.string.chat_title)

        swipeRefresh = findViewById(R.id.chatRefresh)
        statusText = findViewById(R.id.chatStatusText)
        input = findViewById(R.id.chatInput)
        sendButton = findViewById(R.id.chatSendButton)
        emojiButton = findViewById(R.id.chatEmojiButton)
        emojiScroll = findViewById(R.id.chatEmojiScroll)
        recyclerView = findViewById(R.id.chatRecycler)

        layoutManager = LinearLayoutManager(this)
        adapter = MessagesAdapter(sessionStore.getUserId()) { message ->
            confirmDeleteMessage(message)
        }
        recyclerView.layoutManager = layoutManager
        recyclerView.adapter = adapter

        swipeRefresh.setOnRefreshListener { loadMessages() }
        sendButton.setOnClickListener { sendMessage() }
        emojiButton.setOnClickListener {
            emojiScroll.visibility = if (emojiScroll.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }

        val emojiIds = listOf(
            R.id.emojiSmile,
            R.id.emojiLaugh,
            R.id.emojiHeart,
            R.id.emojiThumbs,
            R.id.emojiRobot,
            R.id.emojiFire,
            R.id.emojiCheck,
            R.id.emojiParty,
        )
        val emojiTexts = listOf(":)", ":D", "<3", ";)", "[bot]", "*", "OK", "!")
        emojiIds.zip(emojiTexts).forEach { (id, value) ->
            findViewById<TextView>(id).apply {
                text = value
                setOnClickListener {
                    input.append(value)
                }
            }
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
        if (text.isBlank()) return
        sendButton.isEnabled = false

        CoroutineScope(Dispatchers.IO).launch {
            val response = runCatching {
                ApiClient.api(this@ChatActivity).sendMessage(
                    authorization(),
                    conversationId,
                    SendMessageRequest(text)
                )
            }.getOrNull()
            withContext(Dispatchers.Main) {
                sendButton.isEnabled = true
                if (response == null || !response.isSuccessful || response.body()?.ok != true) {
                    statusText.text = response?.body()?.error ?: extractErrorMessage(response, R.string.send_message_failed)
                    return@withContext
                }
                input.setText("")
                emojiScroll.visibility = View.GONE
                loadMessages(scrollToBottom = true)
            }
        }
    }
}

