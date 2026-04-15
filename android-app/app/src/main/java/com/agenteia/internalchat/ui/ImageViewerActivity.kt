package com.agenteia.internalchat.ui

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import coil.load
import com.agenteia.internalchat.R
import com.agenteia.internalchat.network.ApiClient
import com.agenteia.internalchat.ui.widget.ZoomableImageView

class ImageViewerActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_IMAGE_URL = "image_url"
        const val EXTRA_FALLBACK_URL = "fallback_url"
        const val EXTRA_IMAGE_TITLE = "image_title"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_image_viewer)

        val imageView = findViewById<ZoomableImageView>(R.id.viewerImage)
        val titleView = findViewById<TextView>(R.id.viewerTitle)
        val primaryUrl = intent.getStringExtra(EXTRA_IMAGE_URL).orEmpty()
        val fallbackUrl = intent.getStringExtra(EXTRA_FALLBACK_URL).orEmpty()
        val title = intent.getStringExtra(EXTRA_IMAGE_TITLE).orEmpty()

        titleView.text = if (title.isBlank()) getString(R.string.chat_image_viewer_title) else title
        imageView.load(ApiClient.resolveUrl(this, primaryUrl)) {
            crossfade(true)
            listener(
                onError = { _, _ ->
                    if (fallbackUrl.isNotBlank() && fallbackUrl != primaryUrl) {
                        imageView.load(ApiClient.resolveUrl(this@ImageViewerActivity, fallbackUrl)) {
                            crossfade(true)
                        }
                    }
                }
            )
        }

        imageView.setOnClickListener { finish() }
        findViewById<android.view.View>(R.id.viewerRoot).setOnClickListener { finish() }
    }
}
