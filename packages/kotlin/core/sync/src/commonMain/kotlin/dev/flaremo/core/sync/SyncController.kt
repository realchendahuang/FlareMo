package dev.flaremo.core.sync

import dev.flaremo.core.db.FlareMoDatabase
import dev.flaremo.core.network.CredentialsStore
import dev.flaremo.core.network.DevicePairingClient
import dev.flaremo.core.network.InstanceCredentials
import dev.flaremo.core.network.InstanceUrls
import dev.flaremo.core.network.SyncTransport
import dev.flaremo.core.network.TokenPollResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** 界面要的同步状态：一个不可变快照，UI 直接订阅。 */
data class SyncUiState(
    val connected: Boolean = false,
    val baseUrl: String? = null,
    val syncing: Boolean = false,
    val pendingCount: Int = 0,
    val memoCount: Int = 0,
    val lastSyncAtEpochMillis: Long? = null,
    val lastError: String? = null,
)

/** 配对进行中的提示（桌面端把它显示成一个配对码）。 */
data class PairingPrompt(
    val userCode: String,
    val verificationUri: String,
    val verificationUriComplete: String? = null,
    val expiresInSeconds: Int = 300,
)

/**
 * 同步的「前台」：持有凭据、跑 30s 循环、把结果翻译成 UI 状态。
 *
 * 状态机与传输层分离：传输层只管 HTTP，引擎只管算法，这里只管
 * 「什么时候跑、跑完界面显示什么」。两个 App 注入不同的 [CredentialsStore]。
 */
class SyncController(
    private val database: FlareMoDatabase,
    private val credentialsStore: CredentialsStore,
    private val pairingClient: DevicePairingClient,
    private val transportFactory: (InstanceCredentials) -> SyncTransport,
    private val defaultClientName: String = "FlareMo",
) {
    private val _state = MutableStateFlow(initialState())
    val state: StateFlow<SyncUiState> = _state.asStateFlow()

    private val _pairing = MutableStateFlow<PairingPrompt?>(null)
    val pairing: StateFlow<PairingPrompt?> = _pairing.asStateFlow()

    private var loopJob: Job? = null
    private var connectJob: Job? = null
    private var syncJob: Job? = null

    private fun initialState(): SyncUiState {
        val credentials = credentialsStore.load()
        return SyncUiState(
            connected = credentials != null,
            baseUrl = credentials?.normalizedBaseUrl,
            pendingCount = database.pendingOutboxCount(),
            memoCount = database.countMemos(),
        )
    }

    // MARK: 循环

    /**
     * 起后台循环：每 [intervalMillis] 跑一轮。
     *
     * `shouldSync` 让 Android 把「前台才同步」表达进来（Activity 不在前台时返回 false），
     * 桌面端默认恒 true。
     */
    fun start(
        scope: CoroutineScope,
        intervalMillis: Long = 30_000,
        shouldSync: () -> Boolean = { true },
    ) {
        if (loopJob?.isActive == true) return
        loopJob = scope.launch {
            while (isActive) {
                if (shouldSync()) {
                    runOnceNow()
                }
                delay(intervalMillis)
            }
        }
    }

    fun stop() {
        loopJob?.cancel()
        loopJob = null
        connectJob?.cancel()
        connectJob = null
    }

    /** 手动「立即同步」：不排队，重复点击直接忽略。 */
    fun syncNow(scope: CoroutineScope) {
        if (syncJob?.isActive == true) return
        syncJob = scope.launch { runOnceNow() }
    }

    // MARK: 配对（设备授权）

    /**
     * 用配对码连接一台实例：申请配对码 → 轮询兑换 → 存令牌 → 立刻同步一轮。
     * 配对码通过 [pairing] 暴露给界面。
     */
    fun connect(
        scope: CoroutineScope,
        rawBaseUrl: String,
        clientName: String = defaultClientName,
    ) {
        connectJob?.cancel()
        connectJob = scope.launch {
            val baseUrl = InstanceUrls.normalize(rawBaseUrl)
            if (baseUrl == null) {
                fail("实例地址不合法：$rawBaseUrl")
                return@launch
            }
            _state.update { it.copy(lastError = null) }
            try {
                val authorization = pairingClient.start(baseUrl, clientName)
                _pairing.value = PairingPrompt(
                    userCode = authorization.userCode,
                    verificationUri = authorization.verificationUri,
                    verificationUriComplete = authorization.verificationUriComplete,
                    expiresInSeconds = authorization.expiresIn,
                )
                val deadline = database.currentEpochMillis() + authorization.expiresIn * 1000L
                var interval = authorization.interval.coerceIn(1, 60)
                while (database.currentEpochMillis() < deadline) {
                    delay(interval * 1000L)
                    when (val result = pairingClient.poll(baseUrl, authorization.deviceCode)) {
                        is TokenPollResult.Issued -> {
                            val tokens = result.tokens
                            val expiresAt = if (tokens.expiresIn > 0) {
                                database.currentEpochMillis() + tokens.expiresIn * 1000L
                            } else {
                                null
                            }
                            credentialsStore.save(
                                InstanceCredentials(
                                    baseUrl = baseUrl,
                                    accessToken = tokens.accessToken,
                                    refreshToken = tokens.refreshToken,
                                    expiresAtEpochMillis = expiresAt,
                                    clientName = clientName,
                                ),
                            )
                            database.setSetting("instance_url", baseUrl)
                            _pairing.value = null
                            _state.update {
                                it.copy(connected = true, baseUrl = baseUrl, lastError = null)
                            }
                            runOnceNow()
                            return@launch
                        }
                        TokenPollResult.Pending -> Unit
                        TokenPollResult.SlowDown -> interval = (interval + 5).coerceAtMost(60)
                        TokenPollResult.Denied -> {
                            fail("配对码被拒绝")
                            return@launch
                        }
                        TokenPollResult.Expired -> {
                            fail("配对码已过期，请重试")
                            return@launch
                        }
                        is TokenPollResult.Failure -> {
                            fail(result.message)
                            return@launch
                        }
                    }
                }
                fail("配对超时，请重新发起")
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                fail(error.message ?: "配对失败")
            }
        }
    }

    fun cancelPairing() {
        connectJob?.cancel()
        connectJob = null
        _pairing.value = null
    }

    fun disconnect() {
        cancelPairing()
        credentialsStore.clear()
        _state.update {
            it.copy(connected = false, baseUrl = null, lastError = null, syncing = false)
        }
    }

    // MARK: 内部

    private suspend fun runOnceNow() {
        val credentials = credentialsStore.load()
        if (credentials == null) {
            _state.update {
                it.copy(
                    connected = false,
                    pendingCount = database.pendingOutboxCount(),
                    memoCount = database.countMemos(),
                )
            }
            return
        }
        _state.update { it.copy(syncing = true) }
        try {
            val engine = SyncEngine(database, transportFactory(credentials))
            val summary = engine.runOnce()
            val error = summary.pullError ?: summary.pushError
            _state.update {
                it.copy(
                    connected = true,
                    baseUrl = credentials.normalizedBaseUrl,
                    syncing = false,
                    pendingCount = database.pendingOutboxCount(),
                    memoCount = database.countMemos(),
                    lastSyncAtEpochMillis = database.currentEpochMillis(),
                    lastError = error,
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            _state.update {
                it.copy(
                    syncing = false,
                    pendingCount = database.pendingOutboxCount(),
                    lastError = error.message ?: error.toString(),
                )
            }
        }
    }

    private fun fail(message: String) {
        _pairing.value = null
        _state.update { it.copy(lastError = message) }
    }
}
