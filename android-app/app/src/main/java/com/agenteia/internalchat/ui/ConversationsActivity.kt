package com.agenteia.internalchat.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.agenteia.internalchat.R
import com.agenteia.internalchat.data.DeviceTokenRequest
import com.agenteia.internalchat.data.ServerSettingsStore
import com.agenteia.internalchat.data.SessionStore
import com.agenteia.internalchat.network.ApiClient
import com.agenteia.internalchat.network.InternalChatSocketClient
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ConversationsActivity : AppCompatActivity() {
    private lateinit var sessionStore: SessionStore
    private lateinit var settingsStore: ServerSettingsStore
    private lateinit var adapter: ConversationsAdapter
    private lateinit var statusText: TextView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var backendInfoText: TextView
    private lateinit var socketClient: InternalChatSocketClient

    private val settingsLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        renderBackendInfo()
        loadConversations()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_conversations)
        WindowInsetsHelper.applySystemBarsPadding(findViewById<View>(R.id.conversationsRoot))

        sessionStore = SessionStore(this)
        settingsStore = ServerSettingsStore(this)
        socketClient = InternalChatSocketClient(this)
        if (!sessionStore.isLoggedIn()) {
            logoutToLogin()
            return
        }

        statusText = findViewById(R.id.conversationsStatusText)
        backendInfoText = findViewById(R.id.conversationsBackendInfoText)
        swipeRefresh = findViewById(R.id.conversationsRefresh)
        val recyclerView: RecyclerView = findViewById(R.id.conversationsRecycler)
        val logoutButton: Button = findViewById(R.id.conversationsLogoutButton)
        val settingsButton: Button = findViewById(R.id.conversationsSettingsButton)
        val titleText: TextView = findViewById(R.id.conversationsUserText)

        titleText.text = sessionStore.getUserEmail()
        renderBackendInfo()
        adapter = ConversationsAdapter(
            onTap = { conversation ->
                val intent = Intent(this, ChatActivity::class.java)
                    .putExtra("conversationId", conversation.id)
                    .putExtra("conversationName", conversation.counterpartEmail)
                startActivity(intent)
            },
            onLongTap = { conversation -> confirmDeleteConversation(conversation.id, conversation.counterpartEmail) }
        )
        recyclerView.layoutManager = LinearLayoutManager(this)
        recyclerView.adapter = adapter
        swipeRefresh.setOnRefreshListener { loadConversations() }
        logoutButton.setOnClickListener { logout() }
        settingsButton.setOnClickListener {
            settingsLauncher.launch(Intent(this, SettingsActivity::class.java))
        }

        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            registerDevice(token)
        }
    }

    override fun onResume() {
        super.onResume()
        connectSocket()
        loadConversations()
    }

    override fun onPause() {
        socketClient.disconnect()
        super.onPause()
    }

    private fun connectSocket() {
        socketClient.connect(
            userId = sessionStore.getUserId(),
            onMessage = {
                runOnUiThread {
                    loadConversations(silent = true)
                }
            },
            onRead = {
                runOnUiThread {
                    loadConversations(silent = true)
                }
            }
        )
    }

    private fun renderBackendInfo() {
        backendInfoText.text = getString(R.string.server_in_use, settingsStore.getBackendBaseUrl())
    }

    private fun authorization(): String = "Bearer ${sessionStore.getToken()}"

    private fun loadConversations(silent: Boolean = false) {
        if (!silent) swipeRefresh.isRefreshing = true
        CoroutineScope(Dispatchers.IO).launch {
            val response = runCatching {
                ApiClient.api(this@ConversationsActivity).listConversations(authorization())
            }.getOrNull()

            withContext(Dispatchers.Main) {
                swipeRefresh.isRefreshing = false
                if (response == null || !response.isSuccessful) {
                    statusText.text = getString(R.string.load_conversations_failed)
                    return@withContext
                }
                val body = response.body()
                if (body?.ok != true) {
                    statusText.text = body?.message ?: getString(R.string.load_conversations_failed)
                    return@withContext
                }
                adapter.submit(body.conversations)
                statusText.text = if (body.conversations.isEmpty()) getString(R.string.no_conversations) else ""
            }
        }
    }

    private fun confirmDeleteConversation(conversationId: String, counterpart: String) {
        AlertDialog.Builder(this)
            .setTitle(R.string.delete_chat_title)
            .setMessage(getString(R.string.delete_chat_message, counterpart))
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.delete) { _, _ ->
                deleteConversation(conversationId)
            }
            .show()
    }

    private fun deleteConversation(conversationId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val response = runCatching {
                ApiClient.api(this@ConversationsActivity).deleteConversationPost(authorization(), conversationId)
            }.getOrNull()
            withContext(Dispatchers.Main) {
                if (response == null || !response.isSuccessful || response.body()?.ok != true) {
                    statusText.text = response?.body()?.message ?: getString(R.string.delete_chat_failed)
                    return@withContext
                }
                loadConversations(silent = true)
            }
        }
    }

    private fun registerDevice(token: String) {
        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                ApiClient.api(this@ConversationsActivity).registerDevice(
                    authorization(),
                    DeviceTokenRequest(
                        token = token,
                        deviceName = android.os.Build.MODEL ?: "Android",
                        appVersion = "1.1.0"
                    )
                )
            }
        }
    }

    private fun logout() {
        CoroutineScope(Dispatchers.IO).launch {
            runCatching { ApiClient.api(this@ConversationsActivity).logout(authorization()) }
            withContext(Dispatchers.Main) {
                sessionStore.clear()
                logoutToLogin()
            }
        }
    }

    private fun logoutToLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }
}

