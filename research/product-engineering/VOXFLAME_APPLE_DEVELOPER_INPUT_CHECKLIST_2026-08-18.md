# Apple App 开发所需信息清单

截图能证明 Apple 账号个人资料存在，但不能证明已加入 Apple Developer Program。开发 iOS 采集 App，最小需要确认：

- Apple Developer Program 是否显示 `Active`；若未开通，需要先完成个人/组织注册和年费。
- Team 名称和 `Team ID`（Developer 网站 Account 页面可见）。
- 期望的 Bundle ID；建议沿用仓库的 `org.voxflame.mobileworkbench`，除非你已有正式品牌包名。
- App 名称、支持网址、隐私政策网址、App 图标和麦克风用途说明。
- 是否先做 TestFlight 内测，还是直接准备 App Store；前者只需要开发者团队和签名能力，后者还需要商店元数据、分级、隐私问卷和审核材料。
- 一台可安装测试包的 iPhone/iPad，以及是否允许通过 TestFlight 邀请测试。

不要发送：Apple ID 密码、短信/双重验证码、登录 cookie、Distribution Certificate 私钥、`.p12`、provisioning profile、EAS token。可以在本机完成 `eas login`/`eas build`，只把命令结果中的 Team 状态、构建链接和错误信息发给我。

当前仓库已经具备 Expo iOS export 和 EAS preview 命令；未完成的边界仍是 Apple signing credentials、真机麦克风/回放/上传/弱网验证。账号截图本身不能替代这些验收。
