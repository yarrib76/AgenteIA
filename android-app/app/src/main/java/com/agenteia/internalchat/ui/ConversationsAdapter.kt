package com.agenteia.internalchat.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.agenteia.internalchat.R
import com.agenteia.internalchat.data.ConversationDto

class ConversationsAdapter(
    private val onTap: (ConversationDto) -> Unit
) : RecyclerView.Adapter<ConversationsAdapter.ViewHolder>() {
    private val items = mutableListOf<ConversationDto>()

    fun submit(list: List<ConversationDto>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_conversation, parent, false)
        return ViewHolder(view, onTap)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(items[position])
    }

    class ViewHolder(
        itemView: View,
        private val onTap: (ConversationDto) -> Unit
    ) : RecyclerView.ViewHolder(itemView) {
        private val title: TextView = itemView.findViewById(R.id.conversationTitle)
        private val subtitle: TextView = itemView.findViewById(R.id.conversationSubtitle)
        private val unread: TextView = itemView.findViewById(R.id.conversationUnread)

        fun bind(item: ConversationDto) {
            title.text = item.counterpartEmail.ifBlank { item.counterpartUserId }
            subtitle.text = item.lastMessageText.ifBlank { itemView.context.getString(R.string.no_messages_yet) }
            unread.text = if (item.unreadCount > 0) item.unreadCount.toString() else ""
            itemView.setOnClickListener { onTap(item) }
        }
    }
}
