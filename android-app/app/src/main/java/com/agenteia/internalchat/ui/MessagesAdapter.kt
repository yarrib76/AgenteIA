package com.agenteia.internalchat.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.agenteia.internalchat.R
import com.agenteia.internalchat.data.MessageDto

class MessagesAdapter(
    private val currentUserId: String
) : RecyclerView.Adapter<MessagesAdapter.ViewHolder>() {
    private val items = mutableListOf<MessageDto>()

    fun submit(list: List<MessageDto>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_message, parent, false)
        return ViewHolder(view)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(items[position], currentUserId)
    }

    class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val messageText: TextView = itemView.findViewById(R.id.messageText)
        private val messageMeta: TextView = itemView.findViewById(R.id.messageMeta)

        fun bind(item: MessageDto, currentUserId: String) {
            val isOutgoing = item.senderUserId == currentUserId
            messageText.text = item.text
            messageMeta.text = if (isOutgoing) "Yo" else "Recibido"
            itemView.setBackgroundResource(
                if (isOutgoing) R.drawable.bg_message_out else R.drawable.bg_message_in
            )
        }
    }
}
