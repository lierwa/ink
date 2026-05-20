# Visible Tattoo Warp Design

## Goal

让上传 body 后的 tattoo 能肉眼看到明确弯曲，同时保留拖拽、缩放、旋转的实时贴附语义。

## Architecture

Tattoo 和 body mesh 分离职责。body mesh 只提供局部曲面信息，包括 tattoo 当前覆盖哪块皮肤、局部轴向、边缘距离、曲率代理和可选光影辅助。tattoo 自己生成规则 TPS 网格，并用 transform 后的位置查询 body mesh 得到的曲面信息来弯曲图片。

Pixi 官方 MeshGeometry 使用 positions、uvs、indices 表达几何和纹理采样；scikit-image 的 TPS 示例也使用 source/target 控制点表达平滑非线性图像变形。本设计沿用这两个成熟模式：规则 tattoo UV 网格负责采样原图，TPS 控制点负责改变网格 positions。

## Decisions

- 主渲染路径使用规则 tattoo TPS 网格，不再优先使用 body patch mesh 作为 tattoo mesh。
- body mesh patch 后续只适合作为 clipping 或实验路径，不负责主视觉弯曲。
- 增加 `Warp strength` slider，范围 `0..2`，默认 `1`。`0` 表示不弯，`1` 是正常曲率，`2` 是夸张调试。
- 图片明暗关系会考虑，但只作为弱信号。它通过 `shadingGeometryAssist` 调整曲率 multiplier，不能单独决定弯曲方向或每个 tattoo 顶点位移。
- 如果局部 body mesh 不足，状态显示 `TPS warp unavailable`，不伪装成真实贴附。

## Testing

- domain 测试保证有 body mesh 时仍生成规则 tattoo 网格，而不是 body patch 顶点数。
- domain 测试保证 warp strength 为 0 时接近平面，为 2 时明显增加 displacement。
- app 测试保证 slider 出现在 UI，输入后刷新 tattoo warp。
- 现有 shading assist 测试继续覆盖明暗只增强曲率，不直接改渲染纹理。
