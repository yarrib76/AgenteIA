package com.agenteia.internalchat.data

import android.content.Context

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("internal_chat_session", Context.MODE_PRIVATE)

    fun save(token: String, userEmail: String, userId: String) {
        prefs.edit()
            .putString("token", token)
            .putString("user_email", userEmail)
            .putString("user_id", userId)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun getToken(): String = prefs.getString("token", "") ?: ""

    fun getUserEmail(): String = prefs.getString("user_email", "") ?: ""

    fun getUserId(): String = prefs.getString("user_id", "") ?: ""

    fun isLoggedIn(): Boolean = getToken().isNotBlank()
}
