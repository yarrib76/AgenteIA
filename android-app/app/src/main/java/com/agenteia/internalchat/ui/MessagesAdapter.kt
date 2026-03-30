package com.agenteia.internalchat.ui

import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.agenteia.internalchat.R
import com.agenteia.internalchat.data.MessageDto
import com.agenteia.internalchat.network.ApiClient
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class MessagesAdapter(
    private val currentUserId: String,
    private val onLongTap: (MessageDto) -> Unit
) : RecyclerView.Adapter<MessagesAdapter.ViewHolder>() {
    private val items = mutableListOf<MessageDto>()
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")
        .withZone(ZoneId.systemDefault())

    fun submit(list: List<MessageDto>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_message, parent, false)
        return ViewHolder(view, onLongTap, timeFormatter)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(items[position], currentUserId)
    }

    class ViewHolder(
        itemView: View,
        private val onLongTap: (MessageDto) -> Unit,
        private val timeFormatter: DateTimeFormatter
    ) : RecyclerView.ViewHolder(itemView) {
        private val row: LinearLayout = itemView.findViewById(R.id.messageRow)
        private val bubble: LinearLayout = itemView.findViewById(R.id.messageBubble)
        private val sender: TextView = itemView.findViewById(R.id.messageSender)
        private val messageText: TextView = itemView.findViewById(R.id.messageText)
        private val messageImage: ImageView = itemView.findViewById(R.id.messageImage)
        private val messageMeta: TextView = itemView.findViewById(R.id.messageMeta)

        fun bind(item: MessageDto, currentUserId: String) {
            val isOutgoing = item.senderUserId == currentUserId
            (row.layoutParams as RecyclerView.LayoutParams).width = RecyclerView.LayoutParams.MATCH_PARENT
            row.gravity = if (isOutgoing) Gravity.END else Gravity.START
            bubble.setBackgroundResource(if (isOutgoing) R.drawable.bg_message_out else R.drawable.bg_message_in)
            val showSender = !isOutgoing && item.conversationType == "group"
            sender.visibility = if (showSender) View.VISIBLE else View.GONE
            sender.text = when {
                item.senderUserId == "__system__" -> itemView.context.getString(R.string.robot_label)
                item.senderName.isNotBlank() -> item.senderName
                else -> itemView.context.getString(R.string.message_received)
            }

            val attachment = item.attachment
            if (attachment != null && attachment.type == "image" && attachment.url.isNotBlank()) {
                messageImage.visibility = View.VISIBLE
                messageImage.load(ApiClient.resolveUrl(itemView.context, attachment.url)) {
                    crossfade(true)
                }
            } else {
                messageImage.visibility = View.GONE
                messageImage.setImageDrawable(null)
            }

            if (item.text.isBlank()) {
                messageText.visibility = View.GONE
                messageText.text = ""
            } else {
                messageText.visibility = View.VISIBLE
                messageText.text = item.text
            }

            val time = runCatching { timeFormatter.format(Instant.parse(item.timestamp)) }.getOrDefault("")
            messageMeta.text = if (isOutgoing) "$time  •  ${itemView.context.getString(R.string.you_label)}" else time
            itemView.setOnLongClickListener {
                onLongTap(item)
                true
            }
        }
    }
}

