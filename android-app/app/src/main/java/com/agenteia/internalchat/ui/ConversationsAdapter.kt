package com.agenteia.internalchat.ui

import android.graphics.Typeface
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.agenteia.internalchat.R
import com.agenteia.internalchat.data.ConversationDto
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class ConversationsAdapter(
    private val onTap: (ConversationDto) -> Unit,
    private val onLongTap: (ConversationDto) -> Unit
) : RecyclerView.Adapter<ConversationsAdapter.ViewHolder>() {
    private val items = mutableListOf<ConversationDto>()
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")
        .withZone(ZoneId.systemDefault())

    fun submit(list: List<ConversationDto>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_conversation, parent, false)
        return ViewHolder(view, onTap, onLongTap, timeFormatter)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(items[position])
    }

    class ViewHolder(
        itemView: View,
        private val onTap: (ConversationDto) -> Unit,
        private val onLongTap: (ConversationDto) -> Unit,
        private val timeFormatter: DateTimeFormatter
    ) : RecyclerView.ViewHolder(itemView) {
        private val avatar: TextView = itemView.findViewById(R.id.conversationAvatar)
        private val title: TextView = itemView.findViewById(R.id.conversationTitle)
        private val subtitle: TextView = itemView.findViewById(R.id.conversationSubtitle)
        private val unread: TextView = itemView.findViewById(R.id.conversationUnread)
        private val time: TextView = itemView.findViewById(R.id.conversationTime)

        fun bind(item: ConversationDto) {
            val isRobot = item.counterpartUserId == "__system__"
            avatar.text = if (isRobot) "🤖" else item.counterpartEmail.take(1).uppercase()
            title.text = item.counterpartEmail.ifBlank { item.counterpartUserId }
            subtitle.text = item.lastMessageText.ifBlank { itemView.context.getString(R.string.no_messages_yet) }
            subtitle.setTypeface(null, if (item.unreadCount > 0) Typeface.BOLD else Typeface.NORMAL)
            unread.visibility = if (item.unreadCount > 0) View.VISIBLE else View.GONE
            unread.text = item.unreadCount.toString()
            time.text = item.lastMessageAt?.let {
                runCatching { timeFormatter.format(Instant.parse(it)) }.getOrDefault("")
            }.orEmpty()
            itemView.setOnClickListener { onTap(item) }
            itemView.setOnLongClickListener {
                onLongTap(item)
                true
            }
        }
    }
}
