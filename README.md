# 500px Auto Tag

Chrome 浏览器扩展，为 500px CreatorStudio 自动生成 VCG（视觉中国）风格的图片标题和关键词。基于本地 Ollama Qwen3-VL 视觉模型驱动。

## 功能

- **AI 单张分析**：选中一张图片，自动生成标题、描述和关键词
- **批量处理**：一键遍历所有图片，自动填写，可随时中断
- **智能跳过**：已提交（canSubmit）的图片自动跳过，不重复处理
- **VCG 风格标题**：15~30 字长标题，含主体、场景、光线、氛围
- **中文 / 英文**：支持中英文两种语言输出
- **默认地点填充**：自动填入拍摄地点（支持中国省市）
- **关键词上限**：默认 35 个关键词

## 环境要求

- [Ollama](https://ollama.com/) 运行在本地 `localhost:11434`
- Qwen3-VL 视觉模型（推荐 `qwen3-vl:4b`，约 3GB 显存）

```bash
ollama pull qwen3-vl:4b
```

## 安装使用

1. 下载本仓库代码
2. Chrome 打开 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点「加载已解压的扩展程序」，选择本仓库目录
5. 设置 Ollama 环境变量（Windows）：

```
OLLAMA_ORIGINS=*
```

6. 打开 [creatorstudio.500px.com.cn](https://creatorstudio.500px.com.cn) 上传页
7. 点击图片缩略图选中，再点左下角 `✨ AI Auto Tag` 按钮
8. 或点 `⚡ 批量处理全部` 一键处理所有图片

## 模型选择

打开扩展设置面板，会自动从 Ollama 获取本地模型列表，也可手动选择：

| 模型 | 大小 | 速度 | 适用 |
|------|------|------|------|
| Qwen3-VL 4B | ~3GB | 快 | 推荐，中文好 |
| Qwen3-VL 8B | ~6GB | 中等 | 更准 |
| Qwen3-VL 2B | ~1.5GB | 极快 | 尝鲜 |

## 注意事项

- Ollama 必须设置 `OLLAMA_ORIGINS=*`，否则扩展请求会被 403 拒绝
- 本地推理耗时取决于 GPU，8B 模型单张约 30~60 秒
- 批量处理会按顺序依次处理，可随时点「停止」
- API Key 留空使用本地 Ollama，如需远程部署可填写
