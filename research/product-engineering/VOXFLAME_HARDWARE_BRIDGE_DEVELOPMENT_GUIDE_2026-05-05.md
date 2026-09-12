# VoxFlame Hardware Bridge Development Guide（2026-05-05）

> 目标：最快验证录音和发声硬件是否真的改善 VoxFlame，而不是先做一台完整硬件终端。

## 1. 当前结论

第一阶段最短路线：

1. 先接系统级录音 / 发声外设。
2. 再接 BLE 按钮 / 控制事件。
3. 最后才做 ESP32-S3 自研录放音硬件。

如果你的设备已经把 `录音 + 发声` 融合到一起，先不要按“蓝牙硬件开发”理解它，而要先判断它在系统里暴露成什么。

## 2. 一体化录放设备怎么判断

| 设备在系统里的形态 | 能否最快接入 | VoxFlame 接法 | 是否需要 BLE 代码 |
|---|---:|---|---:|
| USB-C / 有线耳麦，系统显示为麦克风 + 扬声器 | 可以 | App / Web 直接录音和播放 | 不需要 |
| 蓝牙耳机 / 蓝牙会议麦，系统显示为麦克风 + 扬声器 | 可以，但要测音质 | App / Web 直接录音和播放 | 不需要 |
| 普通蓝牙音箱，只显示为扬声器 | 只能发声 | App / Web 播放 TTS / 回放录音 | 不需要 |
| BLE 按钮 / 脚踏，只发事件 | 可以控制 | App 接收 `capture_start / stop / interrupt_tts` | 需要 App BLE |
| ESP32-S3 自研盒子，BLE + I2S 麦 + 小喇叭 | 可以做原型 | App 控制，硬件本地录短 WAV / 播提示音 | 需要 App BLE + 固件 |
| 只支持私有 BLE 音频流的设备 | 不建议 P0 | 需要自定义协议、缓存、解码、上传 | 需要大量工作 |

核心判断：

1. 如果系统已经把它当成麦克风和扬声器，VoxFlame 不需要懂蓝牙。
2. 如果它只是 BLE peripheral，VoxFlame 不能自动把它当麦克风或音箱。
3. 一体化设备也要拆成三条逻辑路线：`input_route`、`output_route`、`control_route`。
4. 第一版不要用 BLE 传实时音频；BLE 先做控制、状态、电量和 telemetry。

## 3. 现有代码能直接支持什么

| 能力 | 现有代码 | 当前状态 |
|---|---|---|
| Web 选择麦克风 | [`frontend/src/app/settings/audio/page.tsx`](../../frontend/src/app/settings/audio/page.tsx)、[`frontend/src/lib/audio/microphone-preferences.ts`](../../frontend/src/lib/audio/microphone-preferences.ts) | 可枚举输入设备、保存首选麦克风、现场电平测试 |
| Web 训练录音 | [`frontend/src/hooks/useMandarinTrainingSession.ts`](../../frontend/src/hooks/useMandarinTrainingSession.ts)、[`frontend/src/app/contribute/page.tsx`](../../frontend/src/app/contribute/page.tsx) | 可录音、回听、上传，并记录麦克风和音质 metadata |
| Web LiveKit 沟通 | [`frontend/src/lib/realtime-audio/session-audio.ts`](../../frontend/src/lib/realtime-audio/session-audio.ts) | LiveKit 发布麦克风轨道时使用首选麦克风 |
| Mobile 原生录音 | [`apps/mobile-workbench/src/queue/use-native-recorder-queue.ts`](../../apps/mobile-workbench/src/queue/use-native-recorder-queue.ts) | 可真机录音、回放、本地 queue、删除、上传 |
| Mobile 上传 | [`apps/mobile-workbench/src/api/mobile-upload-client.ts`](../../apps/mobile-workbench/src/api/mobile-upload-client.ts) | 已走 `/upload/sign -> OSS PUT -> /upload/complete` |
| Mobile LiveKit | [`apps/mobile-workbench/src/realtime/use-livekit-room-connection.ts`](../../apps/mobile-workbench/src/realtime/use-livekit-room-connection.ts) | 已有 room 连接和麦克风发布切片，仍需真机 smoke |

当前还没有：

1. App BLE 扫描 / 连接 / GATT 读写。
2. App 端一体化设备状态页。
3. Mobile 外接麦 / 蓝牙麦 / 输出路线 telemetry。
4. BLE 按钮事件到 recorder queue / LiveKit session 的安全映射。
5. 硬件测试报告页或固定测试表。

## 4. P0：已有一体化设备时怎么测

目标：确认这台设备能不能作为 VoxFlame 第一版硬件外设。

### 4.1 系统识别测试

在手机或电脑系统里确认：

1. 设备是否出现在输入设备列表。
2. 设备是否出现在输出设备列表。
3. 插拔 / 断连后系统是否能恢复默认麦克风和扬声器。
4. Web `/settings/audio` 是否能看到它的输入设备名称。
5. App 真机录音是否走这台设备。

结论记录：

| 项目 | 结果 |
|---|---|
| 输入设备名称 |  |
| 输出设备名称 |  |
| 连接方式 | USB-C / 3.5mm / Bluetooth Classic / BLE / 其他 |
| Web 能否选择输入 | 是 / 否 |
| Mobile 能否录到声音 | 是 / 否 |
| 播放是否从设备发出 | 是 / 否 |
| 断连恢复是否正常 | 是 / 否 |

### 4.2 录音质量测试

每种输入设备录同一组句子：

1. 手机 / 电脑内置麦。
2. 一体化设备麦克风。
3. 如果有 USB-C 领夹麦，也一起对比。

测试句建议：

1. `请等我一下，我正在说。`
2. `我想喝水，不要太冰。`
3. `请帮我联系医生。`
4. `这个地址发给我。`
5. `我需要再说一遍。`

记录表：

| 输入设备 | 场景 | 目标句 | 系统听到 | 回放是否清楚 | 漏字 / 错字 | 是否建议重录 |
|---|---|---|---|---|---|---|
| 内置麦 | 安静 / 轻噪声 |  |  | 是 / 否 |  | 是 / 否 |
| 一体化设备麦 | 安静 / 轻噪声 |  |  | 是 / 否 |  | 是 / 否 |

通过标准：

1. 一体化设备至少在多数样本里比内置麦更清楚或更稳定。
2. 录音没有明显削波、断续、过低音量。
3. Web 训练样本 metadata 能记录实际麦克风 label / device id。
4. Mobile 至少能生成本地录音并回放。

### 4.3 发声质量测试

测试三种输出：

1. 手机外放。
2. 一体化设备扬声器。
3. 便携蓝牙音箱或有线小音箱。

记录表：

| 输出设备 | 0.5m 听清 | 1m 听清 | 轻噪声听清 | 是否刺耳 | 是否可快速停止 |
|---|---|---|---|---|---|
| 手机外放 | 是 / 否 | 是 / 否 | 是 / 否 | 是 / 否 | 是 / 否 |
| 一体化设备扬声器 | 是 / 否 | 是 / 否 | 是 / 否 | 是 / 否 | 是 / 否 |
| 蓝牙音箱 | 是 / 否 | 是 / 否 | 是 / 否 | 是 / 否 | 是 / 否 |

通过标准：

1. 对方 1m 内能听清。
2. 播放延迟不影响对话。
3. 用户能立刻停止播放。
4. 设备声音方向不会让对方误解是谁在说话。

## 5. P1：软件还需要补什么

如果 P0 证明设备有价值，下一步按这个顺序做软件：

1. Mobile Workbench 先完成真机 development build。
2. Practice surface 跑通真实录音、回放、上传 receipt。
3. Communication surface 跑通 LiveKit quick talk。
4. Device surface 增加外设测试状态：
   - 麦克风权限
   - 当前输入路线
   - 当前输出路线说明
   - 最近录音回放
   - 本地 queue
5. Mobile recorder metadata 增加：
   - `input_route`
   - `output_route`
   - `device_label`
   - `device_test_session_id`
6. 如果设备还有 BLE 按钮，再接 `react-native-ble-plx`。

App 比 Web 更适合作为 BLE 主线。Web 只保留：

1. 现有麦克风选择。
2. 浏览器训练录音。
3. 桌面场景外设 smoke。

## 6. P2：如果设备同时有 BLE 控制

第一版 BLE 只接控制，不接实时音频。

事件：

```text
capture_start
capture_stop
replay_last
interrupt_tts
device_state
```

App 映射：

| 硬件事件 | App 行为 | 边界 |
|---|---|---|
| `capture_start` | 准备录音或请求 quick talk | 第一次必须用户确认 |
| `capture_stop` | 停止当前录音 / 说话 turn | 不直接上传高风险内容 |
| `replay_last` | 播放最近本地录音或最近 TTS | App 内可见 |
| `interrupt_tts` | 停止当前播放 | 只影响当前 session |
| `device_state` | 更新连接、电量、录音 / 播放状态 | 不写 durable profile |

禁止：

1. 硬件事件直接删除云端数据。
2. 硬件事件直接改用户画像。
3. 固件保存用户 token。
4. 固件输出用户文本、音频内容或 secret 日志。

## 7. P3：自研 ESP32-S3 录放一体盒

只有 P0 / P1 证明真实价值后再做。

推荐功能：

1. I2S MEMS 麦克风录 3-10 秒 WAV。
2. MAX98357A + 小喇叭播放本地提示音。
3. 2-4 个按钮：录音、停止、回放、打断。
4. RGB LED 显示连接、录音、播放、错误。
5. BLE 连接 App，上报状态和按钮事件。

不做：

1. ESP32-S3 不跑 LiveKit。
2. ESP32-S3 不跑 ASR / LLM / TTS。
3. 第一版不通过 BLE 传大段实时音频。
4. 第一版不让硬件绕过 App 写入用户账户。

上传路线：

```text
ESP32-S3 local wav
  -> App 认领 / 读取 / 代上传
  -> recording envelope
  -> /upload/sign
  -> OSS PUT
  -> /upload/complete
  -> voice_contributions / manifest
```

## 8. 推荐链接

### VoxFlame 内部文档

1. [Mobile Workbench 真机验证手册](VOXFLAME_MOBILE_WORKBENCH_DEVICE_VERIFICATION_RUNBOOK_2026-05-05.md)
2. [语音采集产品规范](../speech-health/VOXFLAME_VOICE_COLLECTION_PRODUCT_SPEC_2026-08-18.md)

### 官方文档

1. Expo Development Builds  
   https://docs.expo.dev/develop/development-builds/introduction/
2. Expo Audio  
   https://docs.expo.dev/versions/latest/sdk/audio/
3. LiveKit React Native  
   https://docs.livekit.io/transport/sdk-platforms/react-native/
4. ESP-IDF ESP32-S3 Get Started  
   https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/get-started/
5. ESP-IDF BLE Guide  
   https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/ble/index.html
6. ESP-IDF I2S Reference  
   https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/i2s.html

### 社区仓库

| 项目 | 链接 | 用途 | VoxFlame 判断 |
|---|---|---|---|
| react-native-ble-plx | https://github.com/dotintent/react-native-ble-plx | React Native BLE central | App BLE 主候选 |
| FastBle | https://github.com/Jasonchenlijian/FastBle | Android 原生 BLE | 只作 Android 原生参考 |
| RxAndroidBle | https://github.com/dariuszseweryn/RxAndroidBle | Android 原生 BLE / RxJava | 当前不采用 |
| Zephyr | https://github.com/zephyrproject-rtos/zephyr | RTOS / BLE 固件 | 中长期参考 |
| OpenMQTTGateway | https://github.com/1technophile/OpenMQTTGateway | ESP32 网关参考 | 不作为音频桥主线 |
| ESP32-A2DP | https://github.com/pschatzmann/ESP32-A2DP | Classic Bluetooth A2DP 实验 | 不适合 ESP32-S3 BLE 控制桥主线 |
| awesome-ble | https://github.com/dotintent/awesome-ble | BLE 学习清单 | 选型参考 |

特别说明：

1. BLE 和 A2DP 蓝牙音频不是一回事。
2. `ESP32-A2DP` 不代表 ESP32-S3 可以当普通蓝牙音箱。
3. VoxFlame 第一版硬件主线是 App 控制和系统音频路由，不是自研实时蓝牙音频协议。

## 9. 最短执行顺序

1. 用已有一体化设备完成系统识别测试。
2. 用 Web `/settings/audio` 和训练页完成录音质量 A/B 测试。
3. 用设备扬声器、手机外放、蓝牙音箱完成发声质量 A/B 测试。
4. 安装 Mobile Workbench development build。
5. 在 App 上重复录音、回放、上传和 LiveKit quick talk。
6. 根据结果决定是否补 Device surface telemetry。
7. 如果设备有 BLE 控制，再接 App BLE。
8. 只有前面通过后，再做 ESP32-S3 自研录放一体盒。
