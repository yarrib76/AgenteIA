package com.agenteia.internalchat.ui

import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

object WindowInsetsHelper {
    fun applySystemBarsPadding(view: View, includeImeBottom: Boolean = false) {
        val initialLeft = view.paddingLeft
        val initialTop = view.paddingTop
        val initialRight = view.paddingRight
        val initialBottom = view.paddingBottom

        ViewCompat.setOnApplyWindowInsetsListener(view) { target, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val imeInsets = if (includeImeBottom) {
                insets.getInsets(WindowInsetsCompat.Type.ime())
            } else {
                Insets.NONE
            }
            val bottomInset = maxOf(systemBars.bottom, imeInsets.bottom)
            target.setPadding(
                initialLeft + systemBars.left,
                initialTop + systemBars.top,
                initialRight + systemBars.right,
                initialBottom + bottomInset
            )
            insets
        }

        ViewCompat.requestApplyInsets(view)
    }
}
