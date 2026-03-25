package app.pornblock.screen

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel

private const val TAG          = "NsfwClassifier"
private const val MODEL_FILE   = "nsfw_model.tflite"
private const val INPUT_SIZE   = 224
private const val PIXEL_SIZE   = 3        // RGB
private const val FLOAT_BYTES  = 4
private const val NSFW_INDEX   = 1        // output[1] = NSFW probability

/**
 * TFLite MobileNetV2-based NSFW image classifier.
 *
 * Expected model contract:
 *   Input:  [1, 224, 224, 3] float32, normalised to [0, 1]
 *   Output: [1, 2] float32  → [sfw_probability, nsfw_probability]
 *
 * Drop `nsfw_model.tflite` into app/src/main/assets/ before building.
 * A compatible open-source model: github.com/GantMan/nsfw_model (Core ML → TFLite)
 */
class NsfwClassifier(context: Context) {

    private var interpreter: Interpreter? = null

    init {
        try {
            val opts = Interpreter.Options().apply {
                numThreads = 2
                useNNAPI   = false  // NNAPI can be unstable; CPU is more reliable
            }
            interpreter = Interpreter(loadModelFile(context), opts)
            Log.i(TAG, "TFLite model loaded")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load TFLite model: ${e.message}")
        }
    }

    /**
     * Classify a bitmap and return the NSFW confidence in [0, 1].
     * Returns -1f if the model has not been loaded.
     */
    fun classify(bitmap: Bitmap): Float {
        val interp = interpreter ?: return -1f

        val scaled    = Bitmap.createScaledBitmap(bitmap, INPUT_SIZE, INPUT_SIZE, true)
        val inputBuf  = bitmapToByteBuffer(scaled)

        // Output buffer: [1][2] float32
        val output = Array(1) { FloatArray(2) }
        interp.run(inputBuf, output)

        return output[0][NSFW_INDEX]
    }

    fun close() {
        interpreter?.close()
        interpreter = null
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun bitmapToByteBuffer(bitmap: Bitmap): ByteBuffer {
        val buf = ByteBuffer
            .allocateDirect(1 * INPUT_SIZE * INPUT_SIZE * PIXEL_SIZE * FLOAT_BYTES)
            .order(ByteOrder.nativeOrder())

        val pixels = IntArray(INPUT_SIZE * INPUT_SIZE)
        bitmap.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)

        for (pixel in pixels) {
            buf.putFloat(((pixel shr 16) and 0xFF) / 255f)  // R
            buf.putFloat(((pixel shr 8)  and 0xFF) / 255f)  // G
            buf.putFloat(( pixel         and 0xFF) / 255f)  // B
        }

        buf.rewind()
        return buf
    }

    private fun loadModelFile(context: Context): java.nio.MappedByteBuffer {
        val afd       = context.assets.openFd(MODEL_FILE)
        val fis       = FileInputStream(afd.fileDescriptor)
        val channel   = fis.channel
        return channel.map(FileChannel.MapMode.READ_ONLY, afd.startOffset, afd.declaredLength)
    }
}
