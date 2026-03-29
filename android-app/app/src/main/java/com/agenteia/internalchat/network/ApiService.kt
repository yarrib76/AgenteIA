package com.agenteia.internalchat.network

import com.agenteia.internalchat.data.ConversationsResponse
import com.agenteia.internalchat.data.DeviceTokenRequest
import com.agenteia.internalchat.data.GenericResponse
import com.agenteia.internalchat.data.LoginRequest
import com.agenteia.internalchat.data.LoginResponse
import com.agenteia.internalchat.data.MeResponse
import com.agenteia.internalchat.data.MessagesResponse
import com.agenteia.internalchat.data.SendMessageRequest
import com.agenteia.internalchat.data.SendMessageResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

interface ApiService {
    @POST("api/mobile/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("api/mobile/logout")
    suspend fun logout(@Header("Authorization") authorization: String): Response<GenericResponse>

    @GET("api/mobile/me")
    suspend fun me(@Header("Authorization") authorization: String): Response<MeResponse>

    @GET("api/mobile/conversations")
    suspend fun listConversations(@Header("Authorization") authorization: String): Response<ConversationsResponse>

    @GET("api/mobile/conversations/{conversationId}/messages")
    suspend fun getConversationMessages(
        @Header("Authorization") authorization: String,
        @Path("conversationId") conversationId: String
    ): Response<MessagesResponse>

    @POST("api/mobile/conversations/{conversationId}/messages")
    suspend fun sendMessage(
        @Header("Authorization") authorization: String,
        @Path("conversationId") conversationId: String,
        @Body request: SendMessageRequest
    ): Response<SendMessageResponse>

    @DELETE("api/mobile/conversations/{conversationId}/messages/{messageId}")
    suspend fun deleteMessage(
        @Header("Authorization") authorization: String,
        @Path("conversationId") conversationId: String,
        @Path("messageId") messageId: String
    ): Response<GenericResponse>

    @POST("api/mobile/conversations/{conversationId}/messages/{messageId}/delete")
    suspend fun deleteMessagePost(
        @Header("Authorization") authorization: String,
        @Path("conversationId") conversationId: String,
        @Path("messageId") messageId: String
    ): Response<GenericResponse>

    @DELETE("api/mobile/conversations/{conversationId}")
    suspend fun deleteConversation(
        @Header("Authorization") authorization: String,
        @Path("conversationId") conversationId: String
    ): Response<GenericResponse>

    @POST("api/mobile/conversations/{conversationId}/delete")
    suspend fun deleteConversationPost(
        @Header("Authorization") authorization: String,
        @Path("conversationId") conversationId: String
    ): Response<GenericResponse>

    @POST("api/mobile/conversations/{conversationId}/read")
    suspend fun markConversationRead(
        @Header("Authorization") authorization: String,
        @Path("conversationId") conversationId: String
    ): Response<GenericResponse>

    @POST("api/mobile/devices")
    suspend fun registerDevice(
        @Header("Authorization") authorization: String,
        @Body request: DeviceTokenRequest
    ): Response<GenericResponse>

    @DELETE("api/mobile/devices/{token}")
    suspend fun deleteDevice(
        @Header("Authorization") authorization: String,
        @Path("token") token: String
    ): Response<GenericResponse>
}
