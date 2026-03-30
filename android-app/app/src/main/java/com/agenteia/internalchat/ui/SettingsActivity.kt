package com.agenteia.internalchat.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.agenteia.internalchat.R
import com.agenteia.internalchat.data.ServerSettingsStore

class SettingsActivity : AppCompatActivity() {
    private lateinit var settingsStore: ServerSettingsStore
    private lateinit var backendUrlInput: EditText
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        title = getString(R.string.server_settings)
        WindowInsetsHelper.applySystemBarsPadding(findViewById<View>(R.id.settingsRoot), includeImeBottom = true)

        settingsStore = ServerSettingsStore(this)
        backendUrlInput = findViewById(R.id.settingsBackendUrlInput)
        statusText = findViewById(R.id.settingsStatusText)
        val saveButton: Button = findViewById(R.id.settingsSaveButton)
        val closeButton: Button = findViewById(R.id.settingsCloseButton)

        backendUrlInput.setText(settingsStore.getBackendBaseUrl())

        saveButton.setOnClickListener {
            val normalized = ServerSettingsStore.normalizeBaseUrl(backendUrlInput.text.toString())
            settingsStore.saveBackendBaseUrl(normalized)
            backendUrlInput.setText(normalized)
            statusText.text = getString(R.string.server_settings_saved)
        }

        closeButton.setOnClickListener {
            setResult(RESULT_OK, Intent())
            finish()
        }
    }
}
