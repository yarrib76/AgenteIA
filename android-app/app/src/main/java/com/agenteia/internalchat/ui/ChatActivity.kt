package com.agenteia.internalchat.ui

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.agenteia.internalchat.R
import com.agenteia.internalchat.data.SendMessageRequest
import com.agenteia.internalchat.data.SessionStore
import com.agenteia.internalchat.network.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ChatActivity : AppCompatActivity() {
    private lateinit var sessionStore: SessionStore
    private lateinit var adapter: MessagesAdapter
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var statusText: TextView
    private lateinit var input: EditText
    private lateinit var sendButton: Button
    private lateinit var recyclerView: RecyclerView
    private lateinit var conversationId: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_chat)

        sessionStore = SessionStore(this)
        conversationId = intent.getStringExtra("conversationId").orEmpty()
        title = intent.getStringExtra("conversationName") ?: getString(R.string.chat_title)

        swipeRefresh = findViewById(R.id.chatRefresh)
        statusText = findViewById(R.id.chatStatusText)
        input = findViewById(R.id.chatInput)
        sendButton = findViewById(R.id.chatSendButton)
        recyclerView = findViewById(R.id.chatRecycler)

        adapter = MessagesAdapter(sessionStore.getUserId())
        recyclerView.layoutManager = LinearLayoutManager(this)
        recyclerView.adapter = adapter

        swipeRefresh.setOnRefreshListener { loadMessages() }
        sendButton.setOnClickListener { sendMessage() }
    }

    override fun onResume() {
        super.onResume()
        loadMessages()
    }

    private fun authorization(): String = "Bearer ${sessionStore.getToken()}"

    private fun loadMessages() {
        swipeRefresh.isRefreshing = true
        CoroutineScope(Dispatchers.IO).launch {
            val response = runCatching {
                ApiClient.api(this@ChatActivity).getConversationMessages(authorization(), conversationId)
            }.getOrNull()
            withContext(Dispatchers.Main) {
                swipeRefresh.isRefreshing = false
                if (response == null || !response.isSuccessful) {
                    statusText.text = getString(R.string.load_messages_failed)
                    return@withContext
                }
                val body = response.body()
                if (body?.ok != true) {
                    statusText.text = body?.message ?: getString(R.string.load_messages_failed)
                    return@withContext
                }
                adapter.submit(body.messages)
                if (body.messages.isNotEmpty()) {
                    recyclerView.scrollToPosition(body.messages.size - 1)
                }
                statusText.text = ""
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
                    statusText.text = response?.body()?.error ?: getString(R.string.send_message_failed)
                    return@withContext
                }
                input.setText("")
                loadMessages()
            }
        }
    }
}
