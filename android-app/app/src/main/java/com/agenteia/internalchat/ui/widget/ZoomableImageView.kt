package com.agenteia.internalchat.ui.widget

import android.content.Context
import android.graphics.Matrix
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import androidx.appcompat.widget.AppCompatImageView
import kotlin.math.max
import kotlin.math.min

class ZoomableImageView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : AppCompatImageView(context, attrs, defStyleAttr) {
    private val drawMatrix = Matrix()
    private val scaleDetector = ScaleGestureDetector(context, ScaleListener())
    private val matrixBounds = RectF()
    private var currentScale = 1f
    private var lastTouchX = 0f
    private var lastTouchY = 0f
    private var isDragging = false

    private val minScale = 1f
    private val maxScale = 4f

    init {
        scaleType = ScaleType.MATRIX
        imageMatrix = drawMatrix
    }

    override fun setImageDrawable(drawable: Drawable?) {
        super.setImageDrawable(drawable)
        post { fitImageToView() }
    }

    override fun setFrame(l: Int, t: Int, r: Int, b: Int): Boolean {
        val changed = super.setFrame(l, t, r, b)
        if (changed) {
            fitImageToView()
        }
        return changed
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastTouchX = event.x
                lastTouchY = event.y
                isDragging = false
            }

            MotionEvent.ACTION_MOVE -> {
                if (!scaleDetector.isInProgress && currentScale > minScale) {
                    val deltaX = event.x - lastTouchX
                    val deltaY = event.y - lastTouchY
                    if (deltaX != 0f || deltaY != 0f) {
                        drawMatrix.postTranslate(deltaX, deltaY)
                        fixTranslation()
                        imageMatrix = drawMatrix
                        isDragging = true
                        lastTouchX = event.x
                        lastTouchY = event.y
                    }
                }
            }

            MotionEvent.ACTION_UP -> {
                if (!isDragging) {
                    performClick()
                }
            }
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    private fun fitImageToView() {
        val drawable = drawable ?: return
        val drawableWidth = drawable.intrinsicWidth.toFloat().takeIf { it > 0f } ?: return
        val drawableHeight = drawable.intrinsicHeight.toFloat().takeIf { it > 0f } ?: return
        val viewWidth = width.toFloat().takeIf { it > 0f } ?: return
        val viewHeight = height.toFloat().takeIf { it > 0f } ?: return

        val scale = min(viewWidth / drawableWidth, viewHeight / drawableHeight)
        val scaledWidth = drawableWidth * scale
        val scaledHeight = drawableHeight * scale
        val translateX = (viewWidth - scaledWidth) / 2f
        val translateY = (viewHeight - scaledHeight) / 2f

        drawMatrix.reset()
        drawMatrix.postScale(scale, scale)
        drawMatrix.postTranslate(translateX, translateY)
        currentScale = minScale
        imageMatrix = drawMatrix
    }

    private fun fixTranslation() {
        val drawable = drawable ?: return
        matrixBounds.set(0f, 0f, drawable.intrinsicWidth.toFloat(), drawable.intrinsicHeight.toFloat())
        drawMatrix.mapRect(matrixBounds)

        val deltaX = when {
            matrixBounds.width() <= width -> (width - matrixBounds.width()) / 2f - matrixBounds.left
            matrixBounds.left > 0f -> -matrixBounds.left
            matrixBounds.right < width -> width - matrixBounds.right
            else -> 0f
        }
        val deltaY = when {
            matrixBounds.height() <= height -> (height - matrixBounds.height()) / 2f - matrixBounds.top
            matrixBounds.top > 0f -> -matrixBounds.top
            matrixBounds.bottom < height -> height - matrixBounds.bottom
            else -> 0f
        }

        if (deltaX != 0f || deltaY != 0f) {
            drawMatrix.postTranslate(deltaX, deltaY)
        }
    }

    private inner class ScaleListener : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val scaleFactor = detector.scaleFactor
            val nextScale = (currentScale * scaleFactor).coerceIn(minScale, maxScale)
            val appliedFactor = nextScale / currentScale
            currentScale = nextScale
            drawMatrix.postScale(appliedFactor, appliedFactor, detector.focusX, detector.focusY)
            fixTranslation()
            imageMatrix = drawMatrix
            return true
        }

        override fun onScaleBegin(detector: ScaleGestureDetector): Boolean = true
    }
}
