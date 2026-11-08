// 本文件由 scripts/apple/gen-theme.mjs 从 apps/web/src/index.css 生成，请勿手改。
// 重新生成：node scripts/apple/gen-theme.mjs（或 pnpm apple:theme）
//
// Compose 没有 oklch，颜色在生成期就转成 ARGB；同一份转换也用于 Swift 侧，
// 两端色值逐位相同。禁止在 Kotlin 里手写十六进制色值。

package dev.flaremo.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Ember 配色的全部颜色 token，亮/暗各一份。 */
@Immutable
data class FlareMoColors(
    /** `--brand-50` */
    val brand50: Color,
    /** `--brand-100` */
    val brand100: Color,
    /** `--brand-200` */
    val brand200: Color,
    /** `--brand-300` */
    val brand300: Color,
    /** `--brand-400` */
    val brand400: Color,
    /** `--brand-500` */
    val brand500: Color,
    /** `--brand-600` */
    val brand600: Color,
    /** `--brand-700` */
    val brand700: Color,
    /** `--brand-coral` */
    val brandCoral: Color,
    /** `--background` */
    val background: Color,
    /** `--foreground` */
    val foreground: Color,
    /** `--card` */
    val card: Color,
    /** `--card-foreground` */
    val cardForeground: Color,
    /** `--popover` */
    val popover: Color,
    /** `--popover-foreground` */
    val popoverForeground: Color,
    /** `--secondary` */
    val secondary: Color,
    /** `--secondary-foreground` */
    val secondaryForeground: Color,
    /** `--accent` */
    val accent: Color,
    /** `--accent-foreground` */
    val accentForeground: Color,
    /** `--muted` */
    val muted: Color,
    /** `--muted-foreground` */
    val mutedForeground: Color,
    /** `--primary` */
    val primary: Color,
    /** `--primary-foreground` */
    val primaryForeground: Color,
    /** `--destructive` */
    val destructive: Color,
    /** `--success` */
    val success: Color,
    /** `--success-foreground` */
    val successForeground: Color,
    /** `--warning` */
    val warning: Color,
    /** `--warning-foreground` */
    val warningForeground: Color,
    /** `--info` */
    val info: Color,
    /** `--info-foreground` */
    val infoForeground: Color,
    /** `--success-emphasis` */
    val successEmphasis: Color,
    /** `--warning-emphasis` */
    val warningEmphasis: Color,
    /** `--info-emphasis` */
    val infoEmphasis: Color,
    /** `--border` */
    val border: Color,
    /** `--input` */
    val input: Color,
    /** `--ring` */
    val ring: Color,
    /** `--glass-tint` */
    val glassTint: Color,
    /** `--glass-rim` */
    val glassRim: Color,
    /** `--glass-edge` */
    val glassEdge: Color,
    /** `--glass-shadow` */
    val glassShadow: Color,
)

val FlareMoLightColors = FlareMoColors(
        brand50 = Color(0xFFFFEEE3),
        brand100 = Color(0xFFFFDFCB),
        brand200 = Color(0xFFFFC2A2),
        brand300 = Color(0xFFFF9C73),
        brand400 = Color(0xFFFB794A),
        brand500 = Color(0xFFE4512C),
        brand600 = Color(0xFFCC2A1B),
        brand700 = Color(0xFFA9141C),
        brandCoral = Color(0xFFF14254),
        background = Color(0xFFFAF7F2),
        foreground = Color(0xFF221D18),
        card = Color(0xFFFFFEFB),
        cardForeground = Color(0xFF211F1C),
        popover = Color(0xFFFFFEFC),
        popoverForeground = Color(0xFF211F1C),
        secondary = Color(0xFFF2EFEA),
        secondaryForeground = Color(0xFF2B2826),
        accent = Color(0xFFF1EDE8),
        accentForeground = Color(0xFF221D18),
        muted = Color(0xFFF0EDE9),
        mutedForeground = Color(0xFF66635E),
        primary = Color(0xFFE4512C),
        primaryForeground = Color(0xFFFDFBFA),
        destructive = Color(0xFFE7000B),
        success = Color(0xFF349D62),
        successForeground = Color(0xFFF4FAF5),
        warning = Color(0xFFCD9130),
        warningForeground = Color(0xFF3B2A17),
        info = Color(0xFF3B82AF),
        infoForeground = Color(0xFFF6F9FB),
        successEmphasis = Color(0xFF036639),
        warningEmphasis = Color(0xFF804D0C),
        infoEmphasis = Color(0xFF185A89),
        border = Color(0xFFE7E3DE),
        input = Color(0xFFDCD8D3),
        ring = Color(0xFFFB794A),
        glassTint = Color(0xC7FFFFFF),
        glassRim = Color(0xE6FFFFFF),
        glassEdge = Color(0x47FFFFFF),
        glassShadow = Color(0x291D140D),
)

val FlareMoDarkColors = FlareMoColors(
        brand50 = Color(0xFFFFEEE3),
        brand100 = Color(0xFFFFDFCB),
        brand200 = Color(0xFFFFC2A2),
        brand300 = Color(0xFFFF9C73),
        brand400 = Color(0xFFFB794A),
        brand500 = Color(0xFFE4512C),
        brand600 = Color(0xFFCC2A1B),
        brand700 = Color(0xFFA9141C),
        brandCoral = Color(0xFFF14254),
        background = Color(0xFF0F0C0A),
        foreground = Color(0xFFF1EEE9),
        card = Color(0xFF1A1714),
        cardForeground = Color(0xFFF1F0EE),
        popover = Color(0xFF201D1A),
        popoverForeground = Color(0xFFF1F0EE),
        secondary = Color(0xFF262523),
        secondaryForeground = Color(0xFFF1F0EE),
        accent = Color(0xFF2C2A27),
        accentForeground = Color(0xFFF1EEE9),
        muted = Color(0xFF252422),
        mutedForeground = Color(0xFF9B9893),
        primary = Color(0xFFFB794A),
        primaryForeground = Color(0xFF22110E),
        destructive = Color(0xFFFF6467),
        success = Color(0xFF51B67A),
        successForeground = Color(0xFF031108),
        warning = Color(0xFFDDA552),
        warningForeground = Color(0xFF211201),
        info = Color(0xFF60A7D6),
        infoForeground = Color(0xFF020F19),
        successEmphasis = Color(0xFF88D9A5),
        warningEmphasis = Color(0xFFF0C781),
        infoEmphasis = Color(0xFF8DCCF9),
        border = Color(0x17FFFFFF),
        input = Color(0x21FFFFFF),
        ring = Color(0xFFFB794A),
        glassTint = Color(0xB31F1915),
        glassRim = Color(0x3DFFFFFF),
        glassEdge = Color(0x14FFFFFF),
        glassShadow = Color(0x00000000),
)

/** 圆角阶梯（基准 10dp）。控件/卡片/弹窗是常用三档。 */
@Immutable
data class FlareMoRadii(
    val sm: Dp = 6.dp,
    val md: Dp = 8.dp,
    val lg: Dp = 10.dp,
    val xl: Dp = 14.dp,
    val xxl: Dp = 18.dp,
    val xxxl: Dp = 22.dp,
    val control: Dp = 10.dp,
    val card: Dp = 14.dp,
    val dialog: Dp = 18.dp,
)

/** 动效时长三档（毫秒）与曲线。 */
@Immutable
data class FlareMoMotion(
    val feedbackMs: Int = 120,
    val overlayMs: Int = 160,
    val surfaceMs: Int = 220,
)

/** 全站排版阶梯，字号/行高（sp）与 Web 端 Type Scale 对齐。 */
@Immutable
data class FlareMoTypography(
    /** 统计大数 text-2xl */
    val display: TextStyle = TextStyle(fontSize = 24.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
    /** 页面大标题 text-xl */
    val title: TextStyle = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
    /** 弹窗/区域标题 text-base */
    val headline: TextStyle = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
    /** 卡片标题 */
    val cardTitle: TextStyle = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
    /** 笔记正文 15sp / leading-7 */
    val body: TextStyle = TextStyle(fontSize = 15.sp, lineHeight = 28.sp),
    /** UI 说明 text-sm */
    val callout: TextStyle = TextStyle(fontSize = 14.sp, lineHeight = 21.sp),
    /** 侧栏/导航项 13.5sp */
    val navigation: TextStyle = TextStyle(fontSize = 13.5.sp, lineHeight = 18.sp),
    /** 分组标签 text-xs */
    val label: TextStyle = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium, lineHeight = 16.sp),
    /** 辅助信息（硬下限 12sp，汉字再小会粘连） */
    val caption: TextStyle = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
    /** 代码 */
    val monospace: TextStyle = TextStyle(fontSize = 13.sp, lineHeight = 20.sp),
)

private val LocalFlareMoColors = staticCompositionLocalOf { FlareMoLightColors }
private val LocalFlareMoRadii = staticCompositionLocalOf { FlareMoRadii() }
private val LocalFlareMoTypography = staticCompositionLocalOf { FlareMoTypography() }
private val LocalFlareMoMotion = staticCompositionLocalOf { FlareMoMotion() }

/** 全局主题入口：`FlareMoTheme { ... }` 包住整棵 UI 树。 */
@Composable
fun FlareMoTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) FlareMoDarkColors else FlareMoLightColors
    CompositionLocalProvider(
        LocalFlareMoColors provides colors,
        LocalFlareMoRadii provides FlareMoRadii(),
        LocalFlareMoTypography provides FlareMoTypography(),
        LocalFlareMoMotion provides FlareMoMotion(),
    ) {
        // 把 token 映射进 Material3，让 M3 组件（TextField 等）也吃到同一套颜色。
        MaterialTheme(
            colorScheme = if (darkTheme) {
                darkColorScheme(
                    primary = colors.primary,
                    onPrimary = colors.primaryForeground,
                    background = colors.background,
                    onBackground = colors.foreground,
                    surface = colors.card,
                    onSurface = colors.cardForeground,
                    surfaceVariant = colors.muted,
                    onSurfaceVariant = colors.mutedForeground,
                    outline = colors.border,
                    error = colors.destructive,
                )
            } else {
                lightColorScheme(
                    primary = colors.primary,
                    onPrimary = colors.primaryForeground,
                    background = colors.background,
                    onBackground = colors.foreground,
                    surface = colors.card,
                    onSurface = colors.cardForeground,
                    surfaceVariant = colors.muted,
                    onSurfaceVariant = colors.mutedForeground,
                    outline = colors.border,
                    error = colors.destructive,
                )
            },
            content = content,
        )
    }
}

/** 取当前主题值的唯一入口。 */
object FlareMoTheme {
    val colors: FlareMoColors
        @Composable @ReadOnlyComposable get() = LocalFlareMoColors.current

    val radii: FlareMoRadii
        @Composable @ReadOnlyComposable get() = LocalFlareMoRadii.current

    val typography: FlareMoTypography
        @Composable @ReadOnlyComposable get() = LocalFlareMoTypography.current

    val motion: FlareMoMotion
        @Composable @ReadOnlyComposable get() = LocalFlareMoMotion.current
}
