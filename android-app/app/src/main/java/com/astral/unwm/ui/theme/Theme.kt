package com.astral.unwm

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.astral.unwm.ui.theme.PurplePrimary
import com.astral.unwm.ui.theme.SurfaceLight
import com.astral.unwm.ui.theme.SurfaceVariantDark
import com.astral.unwm.ui.theme.SurfaceVariantLight
import com.astral.unwm.ui.theme.OutlineDark
import com.astral.unwm.ui.theme.OutlineLight
import com.astral.unwm.ui.theme.SurfaceDark
import com.astral.unwm.ui.theme.TextOnSurface
import com.astral.unwm.ui.theme.TextOnSurfaceDark

private val LightColors = lightColorScheme(
    primary = PurplePrimary,
    onPrimary = Color.White,
    background = SurfaceLight,
    onBackground = TextOnSurface,
    surface = SurfaceLight,
    onSurface = TextOnSurface,
    surfaceVariant = SurfaceVariantLight,
    onSurfaceVariant = TextOnSurface,
    outline = OutlineLight
)

private val DarkColors = darkColorScheme(
    primary = PurplePrimary,
    onPrimary = Color.White,
    background = SurfaceDark,
    onBackground = TextOnSurfaceDark,
    surface = SurfaceDark,
    onSurface = TextOnSurfaceDark,
    surfaceVariant = SurfaceVariantDark,
    onSurfaceVariant = TextOnSurfaceDark,
    outline = OutlineDark
)

@Composable
fun AstralUnwmTheme(content: @Composable () -> Unit) {
    val colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colorScheme,
        typography = MaterialTheme.typography,
        content = content
    )
}
