package com.agenteia.internalchat.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.agenteia.internalchat.R
import com.agenteia.internalchat.data.LoginRequest
import com.agenteia.internalchat.data.ServerSettingsStore
import com.agenteia.internalchat.data.SessionStore
import com.agenteia.internalchat.network.ApiClient
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class LoginActivity : AppCompatActivity() {
    private lateinit var sessionStore: SessionStore
    private lateinit var settingsStore: ServerSettingsStore
    private lateinit var emailInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var statusText: TextView
    private lateinit var loginButton: Button
    private lateinit var backendInfoText: TextView

    private val requestNotifications = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    private val settingsLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        renderBackendInfo()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        sessionStore = SessionStore(this)
        settingsStore = ServerSettingsStore(this)
        if (sessionStore.isLoggedIn()) {
            startActivity(Intent(this, ConversationsActivity::class.java))
            finish()
            return
        }

        emailInput = findViewById(R.id.loginEmailInput)
        passwordInput = findViewById(R.id.loginPasswordInput)
        statusText = findViewById(R.id.loginStatusText)
        loginButton = findViewById(R.id.loginButton)
        backendInfoText = findViewById(R.id.loginBackendInfoText)
        val settingsButton: Button = findViewById(R.id.loginSettingsButton)

        maybeRequestNotifications()
        renderBackendInfo()

        loginButton.setOnClickListener {
            doLogin()
        }
        settingsButton.setOnClickListener {
            settingsLauncher.launch(Intent(this, SettingsActivity::class.java))
        }
    }

    private fun renderBackendInfo() {
        backendInfoText.text = getString(R.string.server_in_use, settingsStore.getBackendBaseUrl())
    }

    private fun maybeRequestNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return
        }
        requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun extractBackendError(rawBody: String): String {
        if (rawBody.isBlank()) return getString(R.string.login_failed)
        return runCatching {
            val json = JSONObject(rawBody)
            json.optString("message").ifBlank { rawBody }
        }.getOrElse { rawBody }
    }

    private fun doLogin() {
        val email = emailInput.text.toString().trim()
        val password = passwordInput.text.toString()
        if (email.isBlank() || password.isBlank()) {
            statusText.text = getString(R.string.login_required_fields)
            return
        }

        loginButton.isEnabled = false
        statusText.text = getString(R.string.logging_in)

        CoroutineScope(Dispatchers.IO).launch {
            val result = runCatching {
                ApiClient.api(this@LoginActivity).login(
                    LoginRequest(
                        email = email,
                        password = password,
                        deviceName = Build.MODEL ?: "Android"
                    )
                )
            }

            withContext(Dispatchers.Main) {
                loginButton.isEnabled = true
                if (result.isFailure) {
                    val detail = result.exceptionOrNull()?.message ?: getString(R.string.login_failed)
                    statusText.text = "Error de red: $detail"
                    return@withContext
                }

                val response = result.getOrNull()
                if (response == null) {
                    statusText.text = getString(R.string.login_failed)
                    return@withContext
                }

                if (!response.isSuccessful) {
                    val errorBody = runCatching { response.errorBody()?.string().orEmpty() }.getOrDefault("")
                    statusText.text = extractBackendError(errorBody)
                    return@withContext
                }

                val body = response.body()
                if (body?.ok != true || body.token.isNullOrBlank() || body.user == null) {
                    statusText.text = body?.message ?: getString(R.string.login_failed)
                    return@withContext
                }
                sessionStore.save(body.token, body.user.email, body.user.id)
                FirebaseMessaging.getInstance().token.addOnSuccessListener { }
                startActivity(Intent(this@LoginActivity, ConversationsActivity::class.java))
                finish()
            }
        }
    }
}
