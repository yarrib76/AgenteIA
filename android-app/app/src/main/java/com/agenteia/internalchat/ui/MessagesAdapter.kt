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
import com.agenteia.internalchat.data.MessageAttachmentDto
import com.agenteia.internalchat.data.MessageDto
import com.agenteia.internalchat.network.ApiClient
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

class MessagesAdapter(
    private val currentUserId: String,
    private val onLongTap: (MessageDto) -> Unit,
    private val onImageTap: (MessageAttachmentDto) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    private sealed interface RowItem {
        data class Separator(val label: String) : RowItem
        data class Message(val value: MessageDto) : RowItem
    }

    private val items = mutableListOf<RowItem>()
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")
        .withZone(ZoneId.systemDefault())
    private val dateFormatter = DateTimeFormatter.ofPattern("d 'de' MMMM 'de' yyyy", Locale("es", "AR"))
    private val zoneId = ZoneId.systemDefault()

    fun submit(list: List<MessageDto>) {
        items.clear()
        items.addAll(buildRows(list))
        notifyDataSetChanged()
    }

    override fun getItemViewType(position: Int): Int {
        return when (items[position]) {
            is RowItem.Separator -> 0
            is RowItem.Message -> 1
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return if (viewType == 0) {
            val view = inflater.inflate(R.layout.item_message_date_separator, parent, false)
            SeparatorViewHolder(view)
        } else {
            val view = inflater.inflate(R.layout.item_message, parent, false)
            MessageViewHolder(view, onLongTap, onImageTap, timeFormatter)
        }
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val item = items[position]) {
            is RowItem.Separator -> (holder as SeparatorViewHolder).bind(item.label)
            is RowItem.Message -> (holder as MessageViewHolder).bind(item.value, currentUserId)
        }
    }

    private fun buildRows(messages: List<MessageDto>): List<RowItem> {
        val rows = mutableListOf<RowItem>()
        var currentDate: LocalDate? = null
        val today = LocalDate.now(zoneId)
        messages.forEach { message ->
            val messageDate = runCatching {
                Instant.parse(message.timestamp).atZone(zoneId).toLocalDate()
            }.getOrNull()
            if (messageDate != null && messageDate != currentDate) {
                val label = if (messageDate == today) {
                    "Hoy"
                } else {
                    dateFormatter.format(messageDate)
                }
                rows += RowItem.Separator(label)
                currentDate = messageDate
            }
            rows += RowItem.Message(message)
        }
        return rows
    }

    private class SeparatorViewHolder(
        itemView: View,
    ) : RecyclerView.ViewHolder(itemView) {
        private val label: TextView = itemView.findViewById(R.id.messageDateLabel)

        fun bind(value: String) {
            label.text = value
        }
    }

    class MessageViewHolder(
        itemView: View,
        private val onLongTap: (MessageDto) -> Unit,
        private val onImageTap: (MessageAttachmentDto) -> Unit,
        private val timeFormatter: DateTimeFormatter
    ) : RecyclerView.ViewHolder(itemView) {
        private val row: LinearLayout = itemView.findViewById(R.id.messageRow)
        private val bubble: LinearLayout = itemView.findViewById(R.id.messageBubble)
        private val sender: TextView = itemView.findViewById(R.id.messageSender)
        private val messageText: TextView = itemView.findViewById(R.id.messageText)
        private val messageImage: ImageView = itemView.findViewById(R.id.messageImage)
        private val messageMeta: TextView = itemView.findViewById(R.id.messageMeta)
        private val messageStatus: TextView = itemView.findViewById(R.id.messageStatus)

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

            val attachment = normalizeImageAttachment(item)
            if (attachment != null && attachment.url.isNotBlank()) {
                messageImage.visibility = View.VISIBLE
                val resolvedUrl = ApiClient.resolveUrl(
                    itemView.context,
                    if (attachment.url.isNotBlank()) attachment.url else attachment.fallbackUrl
                )
                messageImage.load(resolvedUrl) {
                    crossfade(true)
                    listener(
                        onError = { _, _ ->
                            val fallback = attachment.fallbackUrl
                            if (fallback.isNotBlank() && fallback != attachment.url) {
                                messageImage.load(ApiClient.resolveUrl(itemView.context, fallback)) {
                                    crossfade(true)
                                }
                            }
                        }
                    )
                }
                messageImage.setOnClickListener {
                    onImageTap(attachment)
                }
            } else {
                messageImage.visibility = View.GONE
                messageImage.setImageDrawable(null)
                messageImage.setOnClickListener(null)
            }

            if (item.text.isBlank()) {
                messageText.visibility = View.GONE
                messageText.text = ""
            } else {
                messageText.visibility = View.VISIBLE
                messageText.text = item.text
            }

            val time = runCatching { timeFormatter.format(Instant.parse(item.timestamp)) }.getOrDefault("")
            messageMeta.text = time
            val showStatus = isOutgoing && item.conversationType == "direct"
            if (showStatus) {
                messageStatus.visibility = View.VISIBLE
                messageStatus.text = itemView.context.getString(R.string.message_read_check)
                messageStatus.setTextColor(
                    itemView.context.getColor(
                        if (item.readAt.isNullOrBlank()) R.color.message_status_pending
                        else R.color.message_status_read
                    )
                )
            } else {
                messageStatus.visibility = View.GONE
                messageStatus.text = ""
            }
            itemView.setOnLongClickListener {
                onLongTap(item)
                true
            }
        }

        private fun normalizeImageAttachment(item: MessageDto): MessageAttachmentDto? {
            val nested = item.attachment
            if (nested != null && nested.type == "image" && (nested.url.isNotBlank() || nested.fallbackUrl.isNotBlank())) {
                return nested
            }
            if (
                item.attachmentType == "image"
                && item.fileId.isNotBlank()
                && item.attachmentRelativePath.isNotBlank()
            ) {
                return MessageAttachmentDto(
                    type = "image",
                    fileId = item.fileId,
                    mimeType = item.attachmentMimeType,
                    originalName = item.attachmentOriginalName,
                    relativePath = item.attachmentRelativePath,
                    url = "/${item.attachmentRelativePath.trimStart('/')}",
                    fallbackUrl = "/files/content/${item.fileId}",
                )
            }
            return null
        }
    }
}
