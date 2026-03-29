package com.agenteia.internalchat.ui

import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.agenteia.internalchat.R
import com.agenteia.internalchat.data.MessageDto
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
        private val messageMeta: TextView = itemView.findViewById(R.id.messageMeta)

        fun bind(item: MessageDto, currentUserId: String) {
            val isOutgoing = item.senderUserId == currentUserId
            (row.layoutParams as RecyclerView.LayoutParams).width = RecyclerView.LayoutParams.MATCH_PARENT
            row.gravity = if (isOutgoing) Gravity.END else Gravity.START
            bubble.setBackgroundResource(if (isOutgoing) R.drawable.bg_message_out else R.drawable.bg_message_in)
            sender.visibility = if (isOutgoing) View.GONE else View.VISIBLE
            sender.text = if (item.senderUserId == "__system__") itemView.context.getString(R.string.robot_label) else itemView.context.getString(R.string.message_received)
            messageText.text = item.text
            val time = runCatching { timeFormatter.format(Instant.parse(item.timestamp)) }.getOrDefault("")
            messageMeta.text = if (isOutgoing) "$time  •  ${itemView.context.getString(R.string.you_label)}" else time
            itemView.setOnLongClickListener {
                onLongTap(item)
                true
            }
        }
    }
}
