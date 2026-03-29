package com.agenteia.internalchat.data

import android.content.Context
import com.agenteia.internalchat.BuildConfig

class ServerSettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("internal_chat_settings", Context.MODE_PRIVATE)

    fun getBackendBaseUrl(): String {
        val stored = prefs.getString("backend_base_url", "") ?: ""
        return normalizeBaseUrl(if (stored.isBlank()) BuildConfig.BACKEND_BASE_URL else stored)
    }

    fun saveBackendBaseUrl(value: String) {
        prefs.edit()
            .putString("backend_base_url", normalizeBaseUrl(value))
            .apply()
    }

    companion object {
        fun normalizeBaseUrl(value: String): String {
            var next = value.trim()
            if (next.isBlank()) return BuildConfig.BACKEND_BASE_URL
            if (!next.startsWith("http://") && !next.startsWith("https://")) {
                next = "http://$next"
            }
            if (!next.endsWith("/")) {
                next += "/"
            }
            return next
        }
    }
}
