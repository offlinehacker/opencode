package ai.opencode.mobilebridge

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.WebView
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.URL
import java.util.Collections
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.Future

@InvokeArg
class ShareArgs {
    var text: String? = null
    var url: String? = null
}

private data class ScanEntry(val host: String, val port: Int, val url: String)

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")
    ]
)
class MobileBridgePlugin(private val activity: Activity) : Plugin(activity), RecognitionListener {
    private val main = Handler(Looper.getMainLooper())
    private val scanExecutor = Executors.newSingleThreadExecutor()

    private var recognizer: SpeechRecognizer? = null
    private var pendingStop: Invoke? = null
    private var stopTimeout: Runnable? = null
    private var latestText = ""
    private var recording = false

    private var voiceState = "prewarming"
    private var voiceMessage: String? = null

    @Volatile
    private var scanCancelled = false

    @Volatile
    private var scanTask: Future<*>? = null

    override fun load(webView: WebView) {
        super.load(webView)
        setVoiceState("ready")
    }

    override fun onDestroy() {
        super.onDestroy()
        scanCancelled = true
        scanTask?.cancel(true)
        scanExecutor.shutdownNow()
        recording = false
        pendingStop = null
        val timeout = stopTimeout
        if (timeout != null) {
            main.removeCallbacks(timeout)
            stopTimeout = null
        }
        try {
            recognizer?.destroy()
        } catch (_: Throwable) {
        }
        recognizer = null
    }

    @Command
    fun isWhisperReady(invoke: Invoke) {
        invoke.resolve(voicePayload())
    }

    @Command
    fun startRecording(invoke: Invoke) {
        if (recording || pendingStop != null) {
            invoke.resolve(fail("already_recording", "Voice input is already active."))
            return
        }

        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            invoke.resolve(fail("mic_permission_denied", "Microphone permission is required for voice input."))
            return
        }

        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            setVoiceState("error", "Speech recognition is unavailable.")
            invoke.resolve(fail("transcription_unavailable", "Speech recognition is unavailable."))
            setVoiceState("ready")
            return
        }

        try {
            if (recognizer == null) {
                recognizer = SpeechRecognizer.createSpeechRecognizer(activity)
                recognizer?.setRecognitionListener(this)
            }

            latestText = ""
            recording = true
            setVoiceState("recording")

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            }

            recognizer?.startListening(intent)

            val ret = JSObject()
            ret.put("ok", true)
            invoke.resolve(ret)
        } catch (_: Throwable) {
            recording = false
            setVoiceState("error", "Failed to start speech recognition.")
            invoke.resolve(fail("recorder_start_failed", "Failed to start microphone recording."))
            setVoiceState("ready")
        }
    }

    @Command
    fun stopRecording(invoke: Invoke) {
        if (!recording) {
            invoke.resolve(stopResult("", "not_recording", "Voice input is not currently recording."))
            return
        }

        recording = false
        pendingStop = invoke
        setVoiceState("processing")

        try {
            recognizer?.stopListening()
        } catch (_: Throwable) {
            finishStop("", "transcription_failed", "Voice transcription failed.")
            return
        }

        val timeout = Runnable {
            val text = latestText.trim()
            if (text.isNotEmpty()) {
                finishStop(text)
                return@Runnable
            }
            finishStop("", "transcription_failed", "Voice transcription failed.")
        }
        stopTimeout = timeout
        main.postDelayed(timeout, 5000)
    }

    @Command
    fun scanNetwork(invoke: Invoke) {
        scanCancelled = false
        scanTask?.cancel(true)

        scanTask = scanExecutor.submit {
            val results = runScan()
            if (scanCancelled) {
                main.post { invoke.resolve(ArrayList<JSObject>()) }
                return@submit
            }
            main.post { invoke.resolve(results) }
        }
    }

    @Command
    fun cancelScan(invoke: Invoke) {
        scanCancelled = true
        scanTask?.cancel(true)
        invoke.resolve()
    }

    @Command
    fun share(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        val parts = listOfNotNull(args.text?.trim()?.takeIf { it.isNotEmpty() }, args.url?.trim()?.takeIf { it.isNotEmpty() })
        if (parts.isEmpty()) {
            invoke.resolve(false)
            return
        }

        val text = parts.joinToString("\n")
        val sendIntent = Intent().apply {
            action = Intent.ACTION_SEND
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }

        try {
            activity.startActivity(Intent.createChooser(sendIntent, null))
            invoke.resolve(true)
        } catch (_: Throwable) {
            invoke.resolve(false)
        }
    }

    private fun runScan(): ArrayList<JSObject> {
        val local = localAddress() ?: return ArrayList()
        val prefix = local.substringBeforeLast('.', missingDelimiterValue = "")
        if (prefix.isEmpty()) return ArrayList()

        val pool = Executors.newFixedThreadPool(48)
        val futures = ArrayList<Future<ScanEntry?>>()

        for (i in 1..254) {
            if (scanCancelled) break
            val host = "$prefix.$i"
            futures.add(pool.submit<ScanEntry?> { probeHost(host) })
        }

        val found = ArrayList<ScanEntry>()
        for (future in futures) {
            if (scanCancelled) break
            val item = try {
                future.get()
            } catch (_: Throwable) {
                null
            }
            if (item != null) found.add(item)
        }

        pool.shutdownNow()

        val out = ArrayList<JSObject>()
        found.sortedBy { it.host }.forEach {
            val value = JSObject()
            value.put("host", it.host)
            value.put("port", it.port)
            value.put("url", it.url)
            out.add(value)
        }
        return out
    }

    private fun probeHost(host: String): ScanEntry? {
        if (scanCancelled || Thread.currentThread().isInterrupted) return null

        val port = 4096
        val socket = Socket()
        return try {
            socket.connect(InetSocketAddress(host, port), 300)
            socket.close()

            val base = "http://$host:$port"
            if (!checkHealth("$base/global/health") && !checkHealth("$base/health")) return null
            ScanEntry(host = host, port = port, url = base)
        } catch (_: Throwable) {
            null
        } finally {
            try {
                socket.close()
            } catch (_: Throwable) {
            }
        }
    }

    private fun checkHealth(url: String): Boolean {
        if (scanCancelled || Thread.currentThread().isInterrupted) return false
        val connection = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (_: Throwable) {
            return false
        }

        return try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 1000
            connection.readTimeout = 1000
            connection.connect()
            val code = connection.responseCode
            code in 200..299
        } catch (_: Throwable) {
            false
        } finally {
            connection.disconnect()
        }
    }

    private fun localAddress(): String? {
        val interfaces = try {
            Collections.list(NetworkInterface.getNetworkInterfaces())
        } catch (_: Throwable) {
            return null
        }

        for (network in interfaces) {
            if (!network.isUp || network.isLoopback) continue
            val addresses = Collections.list(network.inetAddresses)
            for (address in addresses) {
                if (address.isLoopbackAddress) continue
                if (address is Inet4Address) return address.hostAddress
            }
        }

        return null
    }

    private fun finishStop(text: String, code: String? = null, message: String? = null) {
        val invoke = pendingStop ?: return
        pendingStop = null

        val timeout = stopTimeout
        if (timeout != null) {
            main.removeCallbacks(timeout)
            stopTimeout = null
        }

        if (code == null) {
            invoke.resolve(stopResult(text))
            setVoiceState("ready")
            return
        }

        invoke.resolve(stopResult(text, code, message))
        setVoiceState("error", message)
        setVoiceState("ready")
    }

    private fun stopResult(text: String, code: String? = null, message: String? = null): JSObject {
        val ret = JSObject()
        ret.put("text", text)
        if (code != null) ret.put("code", code)
        if (message != null) ret.put("message", message)
        return ret
    }

    private fun fail(code: String, message: String): JSObject {
        val ret = JSObject()
        ret.put("ok", false)
        ret.put("code", code)
        ret.put("message", message)
        return ret
    }

    private fun voicePayload(): JSObject {
        val ret = JSObject()
        ret.put("state", voiceState)
        ret.put("ready", voiceState == "ready")
        if (!voiceMessage.isNullOrEmpty()) ret.put("message", voiceMessage)
        return ret
    }

    private fun setVoiceState(state: String, message: String? = null) {
        voiceState = state
        voiceMessage = message
        trigger("voiceState", voicePayload())
    }

    override fun onReadyForSpeech(params: Bundle?) {}

    override fun onBeginningOfSpeech() {}

    override fun onRmsChanged(rmsdB: Float) {}

    override fun onBufferReceived(buffer: ByteArray?) {}

    override fun onEndOfSpeech() {}

    override fun onError(error: Int) {
        val reason = when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "Audio recording error."
            SpeechRecognizer.ERROR_CLIENT -> "Speech recognition client error."
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required for voice input."
            SpeechRecognizer.ERROR_NETWORK -> "Network error during speech recognition."
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition network timeout."
            SpeechRecognizer.ERROR_NO_MATCH -> "No speech could be recognized."
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer is busy."
            SpeechRecognizer.ERROR_SERVER -> "Speech recognition service error."
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech recognition timed out."
            else -> "Voice transcription failed."
        }

        if (pendingStop != null) {
            val text = latestText.trim()
            if (text.isNotEmpty()) {
                finishStop(text)
                return
            }
            finishStop("", "transcription_failed", reason)
            return
        }

        recording = false
        setVoiceState("error", reason)
        setVoiceState("ready")
    }

    override fun onResults(results: Bundle?) {
        val text = results
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            ?.trim()
            .orEmpty()

        if (pendingStop != null) {
            val finalText = if (text.isNotEmpty()) text else latestText.trim()
            if (finalText.isEmpty()) {
                finishStop("", "transcription_failed", "Voice transcription failed.")
                return
            }
            finishStop(finalText)
            return
        }

        if (text.isNotEmpty()) {
            latestText = text
            val payload = JSObject()
            payload.put("text", text)
            payload.put("isFinal", true)
            trigger("transcription", payload)
        }

        recording = false
        setVoiceState("ready")
    }

    override fun onPartialResults(partialResults: Bundle?) {
        val text = partialResults
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            ?.trim()
            .orEmpty()
        if (text.isEmpty()) return
        latestText = text
        val payload = JSObject()
        payload.put("text", text)
        payload.put("isFinal", false)
        trigger("transcription", payload)
    }

    override fun onEvent(eventType: Int, params: Bundle?) {}
}
