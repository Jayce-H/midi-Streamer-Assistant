try {
    var runtimes = require("./src/runtimes.js");
    var getPosInteractive = require("./src/getPosInteractive.js");
    var MidiDeviceManager = require("./src/midiDeviceManager.js");
    var GameProfile = require("./src/gameProfile.js");
    var { playerType, AutoJsGesturePlayer } = require("./src/players.js");
    var configuration = require("./src/configuration.js");
    var FloatButton = require("./src/FloatButton/FloatButton.js");
} catch (e) {
    toast("模块加载错误");
    toast(e);
    console.error(e);
}

const scriptVersion = 26;

//应用名称, 稍后会被初始化
let appName = undefined;
let gameProfile = new GameProfile();

const setGlobalConfig = configuration.setGlobalConfig;
const readGlobalConfig = configuration.readGlobalConfig;

/**
 * @brief 导出数据的格式类型
 * @enum {string}
 */
const ScoreExportType = {
    none: "none",
    keyboardScore: "keyboardScore",
    keySequenceJSON: "keySequenceJSON",
};

/**
 * @enum {string}
 */
const ScriptOperationMode = {
    NotRunning: "NotRunning",
    FilePlayer: "FilePlayer",
    MIDIInputStreaming: "MIDIInputStreaming",
};

/**
 * @enum {string}
 */
const MusicLoaderDataType = {
    GestureSequence: "GestureSequence",
    KeySequence: "KeySequence",
    KeySequenceHumanFriendly: "KeySequenceHumanFriendly",
};


/**
     * @type {Array<pos2d>?}
     * @description 按键位置数组(从下到上, 从左到右)
     */
var cachedKeyPos = null;//自定义坐标的数值

var keyStates = new Map();//实时保存midi键按下弹起状态，长按用
var type = null ;//异形屏适配:0平板全屏，1左侧挖孔刘海药丸，2翻转后位于屏幕右侧

/**
 * @brief 加载配置文件
 */
function loadConfiguration() {
    try {
        // TODO: 自定义配置
        let userGameProfile = readGlobalConfig("userGameProfile", null);
        if (userGameProfile != null) {
            gameProfile.loadGameConfigs(userGameProfile);
        } else {
            gameProfile.loadDefaultGameConfigs();
        }
        let lastConfigName = readGlobalConfig("lastConfigName", "");
        //尝试加载用户设置的游戏配置
        let activeConfigName = readGlobalConfig("activeConfigName", null);
        let res = gameProfile.setConfigByName(activeConfigName);
        if (res == false) {
            console.log("尝试加载用户设置的游戏配置...失败!");
        } else {
            console.log("尝试加载用户设置的游戏配置...成功, 当前配置: " + gameProfile.getCurrentConfigTypeName());
        }

        //尝试通过包名加载游戏配置 (加载失败后保留当前配置)
        if (auto.service != null) {
            let currentPackageName = currentPackage();
            console.log("当前包名:" + currentPackageName);
            res = gameProfile.setConfigByPackageName(currentPackageName);
            if (res == false) {
                console.log("尝试通过包名加载游戏配置...失败!");
            } else {
                console.log("尝试通过包名加载游戏配置...成功, 当前配置: " + gameProfile.getCurrentConfigTypeName());
                //保存当前配置
                setGlobalConfig("activeConfigName", gameProfile.getCurrentConfigTypeName());
            }
        } else {
            console.log("未启用无障碍服务, 跳过尝试通过包名加载游戏配置");
        }

        if (gameProfile.getCurrentConfig() == null) {
            console.error("未找到合适配置, 已加载默认配置!");
            toast("未找到合适配置, 已加载默认配置!");
        }

        if (lastConfigName != gameProfile.getCurrentConfigTypeName()) {
            //如果配置发生了变化, 则清空上次的变体与键位配置
            setGlobalConfig("lastConfigName", gameProfile.getCurrentConfigTypeName());
            setGlobalConfig("lastVariantName", "");
            setGlobalConfig("lastKeyTypeName", "");
        }

        //加载变体配置和键位配置
        let lastVariantName = readGlobalConfig("lastVariantName", "");
        if (lastVariantName != "") {
            let res = gameProfile.setCurrentVariantByTypeName(lastVariantName);
            if (res == false) {
                console.log("尝试加载用户设置的变体配置...失败!");
                gameProfile.setCurrentVariantDefault();
            } else {
                console.log("尝试加载用户设置的变体配置...成功");
            }
        } else {
            gameProfile.setCurrentVariantDefault();
            console.log("游戏配置发生变化, 已加载默认变体配置");
        }
        setGlobalConfig("lastVariantName", gameProfile.getCurrentVariantTypeName());

        let lastKeyTypeName = readGlobalConfig("lastKeyTypeName", "");
        if (lastKeyTypeName != "") {
            let res = gameProfile.setCurrentKeyLayoutByTypeName(lastKeyTypeName);
            if (res == false) {
                console.log("尝试加载用户设置的键位配置...失败!");
                gameProfile.setCurrentKeyLayoutDefault();
            } else {
                console.log("尝试加载用户设置的键位配置...成功");
            }
        } else {
            gameProfile.setCurrentKeyLayoutDefault();
            console.log("游戏配置发生变化, 已加载默认键位配置");
        }
        setGlobalConfig("lastKeyTypeName", gameProfile.getCurrentKeyLayoutTypeName());

    } catch (error) {
        toastLog("加载配置文件失败! 已自动加载默认配置!");
        console.warn(error);
        gameProfile.loadDefaultGameConfigs();
        setGlobalConfig("userGameProfile", null);
    }
}

/**
 * 启动midi串流
 * @returns {{
 *  onDataReceived: (callback: (data: Array<Uint8Array>) => void) => void,
 *  close: () => void,
 * } | null}
 */
function setupMidiStream() {
    const midiEvt = events.emitter(threads.currentThread());
    /** @type {MidiDeviceManager} */
    //@ts-ignore
    let midi = null;
    const midiThread = threads.start(function () {
        setInterval(function () {}, 1000);
        midi = new MidiDeviceManager();
    });
    midiThread.waitFor();
    while (midi == null) {
        sleep(100);
    }
    let devNames = [];
    while (1) {
        devNames = midi.getMidiDeviceNames();
        if (devNames.length == 0) {
            if (!dialogs.confirm(
                "错误", 
                "没有找到MIDI设备, 点击确定重试, 点击取消退出" 
                )) {
                return null;
            }
        } else {
            break;
        }
    }
    let deviceIndex = dialogs.select("选择MIDI设备", devNames);
    if (deviceIndex == -1) {
        toast("您取消了选择");
        return null;
    }
    let portNames = midi.getMidiPortNames(deviceIndex);
    if (portNames.length == 0) {
        dialogs.alert("错误", "此MIDI设备没有可用的端口");
        return null;
    }
    let portIndex = 0;
    if (portNames.length > 1) {  // 不太可能出现
        portIndex = /** @type {Number} */ (dialogs.select("选择MIDI端口", portNames));
        if (portIndex == -1) {
            toast("您取消了选择");
            return null;
        }
    }
    midiThread.setImmediate(() => {
        midi.openDevicePort(deviceIndex, portIndex);
        midi.setDataReceivedCallback(() => {
            midiEvt.emit("dataReceived");
        });
    });

    let _onDataReceived = (data) => { };

    midiEvt.on("dataReceived", () => {
        let keyList = [];
        if (!midi.dataAvailable()) {
            return;
        }
        while (midi.dataAvailable()) {
            _onDataReceived(midi.readAll());
        }
    });

    return {
        onDataReceived: (callback) => {
            _onDataReceived = callback;
        },
        close: () => {
            midi.close();
            midiThread.interrupt();
        }
    }
}

function checkEnableAccessbility() {
    //启动无障碍服务
    console.verbose("等待无障碍服务..");
    //toast("请允许本应用的无障碍权限");
    if (auto.service == null) {
        toastLog(`请打开应用 "${appName}" 的无障碍权限!`);
        auto.waitFor();
        toastLog(`无障碍权限已开启!`);
        return false;
    }
    toastLog(`无障碍权限已开启!`);
    console.verbose("无障碍服务已启动");
    return true;
}

function saveUserGameProfile() {
    let profile = gameProfile.getGameConfigs();
    setGlobalConfig("userGameProfile", profile);
    console.log("保存用户游戏配置成功");
    toast("保存用户游戏配置成功");
};

function runClickPosSetup() {
    let pos1 = getPosInteractive("最左上按键的中心",type);
    let pos2 = getPosInteractive("最右下按键的中心",type);

    console.log("自定义坐标:左上[" + pos1.x + "," + pos1.y + "],右下[" + pos2.x + "," + pos2.y + "]");

    gameProfile.setKeyPosition([pos1.x, pos1.y], [pos2.x, pos2.y]);
    saveUserGameProfile();
}

function getTargetTriple() {
    let configName = gameProfile.getCurrentConfigDisplayName();
    let variantName = gameProfile.getCurrentVariantDisplayName();
    let keyTypeName = gameProfile.getCurrentKeyLayoutDisplayName();
    return configName + " " + variantName + " " + keyTypeName;
}


/////////
//主程序//
/////////
function initialize() {
    let currentRuntime = runtimes.getCurrentRuntime();
    switch (currentRuntime) {
        case runtimes.Runtime.AUTOJS6:
            console.info("当前运行环境: AutoJs6");
            break;
        case runtimes.Runtime.AUTOXJS:
            console.info("当前运行环境: AutoX.js");
            break;
        default:
            console.warn("当前运行环境: 不支持或未知!");
            break;
    }
    if (readGlobalConfig("lastVersion", 0) != scriptVersion) {
        //第一次启动，初始化设置
        toast("版本变更，正在初始化设置..");
        configuration.clear();
        if (readGlobalConfig("skipInit", -1) == -1) setGlobalConfig("skipInit", true);
        if (readGlobalConfig("skipBlank5s", -1) == -1) setGlobalConfig("skipBlank5s", false);
        if (readGlobalConfig("waitForGame", -1) == -1) setGlobalConfig("waitForGame", true);
        setGlobalConfig("userGameProfile", null);
        setGlobalConfig("lastVersion", scriptVersion);
    };
}

function main() {
    let evt = events.emitter(threads.currentThread());

    const haveFloatyPermission = runtimes.getCurrentRuntime() === runtimes.Runtime.AUTOXJS ?
        floaty.checkPermission() :
        floaty.hasPermission();
    if (!haveFloatyPermission) {
        // 没有悬浮窗权限，提示用户并跳转请求
        toastLog(`请打开应用 "${appName}" 的悬浮窗权限!`);
        floaty.requestPermission();
        while (!floaty.checkPermission());
        toastLog('悬浮窗权限已开启');
    }

    let titleStr = "点击文字调整位置";
    console.info(titleStr);
    /**
     * @type {Array<import("./src/players").PlayerBase>}
     */
    let selectedPlayers = [new AutoJsGesturePlayer()];
    let instructWindow = null;

    //显示悬浮窗
    /**
     * @type {any}
     */
    let controlWindow = floaty.window(
        <frame gravity="left|top" w="120dp" h="50dp" margin="0dp" id="controlWindowFrame" visibility="gone">
            <vertical bg="#55ffffff" w="120dp" h="auto" margin="0dp">
                <horizontal w="120dp" h="auto" margin="0dp">
                    <text id="musicTitleText" bg="#55ffffff" w="120dp" text="点击文字调整位置" ellipsize="marquee" singleLine="true" layout_gravity="center" textSize="14sp" margin="0 0 0 0" layout_weight="1" />
                </horizontal>
                <horizontal bg="#88ffffff" w="120dp" h="auto" margin="0dp" gravity="left">
                    <button id="gameBtn" style="Widget.AppCompat.Button.Borderless" w="30dp" h='30dp' text="🎮" textSize="20sp" margin="0dp" padding="0dp" />
                    <button id="posBtn" style="Widget.AppCompat.Button.Borderless" w="30dp" h='30dp' text="📍" textSize="20sp" margin="0dp" padding="0dp" />
                    <button id="midiBtn" style="Widget.AppCompat.Button.Borderless" w="30dp" h='30dp' text="🎹" textSize="20sp" margin="0dp" padding="0dp" />
                    <button id="globalConfigBtn" style="Widget.AppCompat.Button.Borderless" w="30dp" h='30dp' text="⚙️" textSize="20sp" margin="0dp" padding="0dp" />
                </horizontal>
            </vertical>
        </frame>
    );
    let controlWindowVisible = false;
    /**
     * @param {boolean} visible
     */
    function controlWindowSetVisibility(visible) {
        ui.run(() => {
            if (visible) {
                controlWindow.controlWindowFrame.setVisibility(android.view.View.VISIBLE);
            } else {
                controlWindow.controlWindowFrame.setVisibility(android.view.View.GONE);
            }
        });
    }

    ui.run(() => {
        controlWindow.musicTitleText.setText(titleStr);
        controlWindow.musicTitleText.setSelected(true);
    });

    controlWindow.gameBtn.click(() => {
        evt.emit("gameBtnClick");
    });
    controlWindow.posBtn.click(() => {
        evt.emit("posBtnClick");
    });
    controlWindow.midiBtn.click(() => {
        evt.emit("midiBtnClick");
    });
    
    controlWindow.globalConfigBtn.click(() => { evt.emit("globalConfigBtnClick"); });

    //悬浮窗位置/大小调节
    let controlWindowPosition = readGlobalConfig("controlWindowPosition", [device.width / 4, device.height / 5 ]);
    //避免悬浮窗被屏幕边框挡住
    controlWindow.setPosition(controlWindowPosition[0], controlWindowPosition[1]);
    let controlWindowSize = readGlobalConfig("controlWindowSize", [-2, -2]);
    controlWindow.setSize(controlWindowSize[0], controlWindowSize[1]);
    //controlWindow.setTouchable(true);

    let controlWindowLastClickTime = 0;
    //悬浮窗事件
    controlWindow.musicTitleText.on("click", () => {
        let now = new Date().getTime();
        if (now - controlWindowLastClickTime < 500) {
            toast("重置悬浮窗大小与位置");
            controlWindow.setSize(-2, -2);
            controlWindow.setPosition(device.width / 4, device.height / 5);
        }
        controlWindowLastClickTime = now;

        let adjEnabled = controlWindow.isAdjustEnabled();
        controlWindow.setAdjustEnabled(!adjEnabled);

        //记忆位置
        if (adjEnabled) {
            controlWindow.setSize(controlWindow.getWidth(), controlWindow.getHeight());
            setGlobalConfig("controlWindowPosition", [controlWindow.getX(), controlWindow.getY()]);
            setGlobalConfig("controlWindowSize", [controlWindow.getWidth(), -2]);
        }
    });

    function exitApp() {
        if(instructWindow != null) instructWindow.close();
        controlWindow.close();
        threads.shutDownAll();
        exit();
    }


    let diy = false;//diy
    let diybool = false;//延音开关
    var diytime = 20;//默认10ms
    var diysleeptime = 0;//默认5ms

    evt.on("gameBtnClick", () => {
        //目标游戏
        let configList = gameProfile.getConfigNameList();
        let sel = /** @type {Number} */ (dialogs.select("选择目标游戏...", configList));
        let configName = readGlobalConfig("activeConfigName",null);
        if (sel == -1) {
            if (configName == null){
                toastLog("未选择游戏");
                return;
            }
            toastLog("设置没有改变");
            return;
        }
        else if (sel == 15){
            diy = true;
            console.log("口袋琴自定义");
            configName = configList[sel];
        }else {
            diy = false;
            configName = configList[sel];
        }
        setGlobalConfig("activeConfigName", configName);
        setGlobalConfig("lastConfigName", configName);
        gameProfile.setConfigByName(configName);
        console.log("目标游戏已设置为: " + configName);
        //目标乐器
        let instrumentList = gameProfile.getCurrentAvailableVariants();
        if (instrumentList == null || instrumentList.length == 0) {
            throw new Error("当前游戏没有可用的乐器!");
        } else if (instrumentList.length == 1) {
            gameProfile.setCurrentVariantDefault();
            setGlobalConfig("lastVariantName", gameProfile.getCurrentVariantTypeName());
        } else {
            let nameList = instrumentList.map((variant) => variant.variantName);
            let sel = /** @type {Number} */ (dialogs.select("选择目标乐器...", nameList));
            if (sel == -1) {
                toastLog("设置没有改变");
            }
            let typeName = instrumentList[sel].variantType;
            gameProfile.setCurrentVariantByTypeName(typeName);
            setGlobalConfig("lastVariantName", typeName);
            console.log("目标乐器已设置为: " + typeName);
        }
        //目标键位
        let keyLayoutList = gameProfile.getCurrentAvailableKeyLayouts();
        if (keyLayoutList == null || keyLayoutList.length == 0) {
            throw new Error("当前游戏没有可用的键位!");
        } else if (keyLayoutList.length == 1) {
            gameProfile.setCurrentKeyLayoutDefault();
            setGlobalConfig("lastKeyTypeName", gameProfile.getCurrentKeyLayoutTypeName());
        } else {
            let allKeyLayoutList = gameProfile.getAllKeyLayouts();
            let nameList = keyLayoutList.map((keyLayout) => allKeyLayoutList[keyLayout].displayName);
            let sel = /** @type {Number} */ (dialogs.select("选择目标键位...", nameList));
            if (sel == -1) {
                toastLog("设置没有改变");
            }
            let typeName = keyLayoutList[sel];
            gameProfile.setCurrentKeyLayoutByTypeName(typeName);
            setGlobalConfig("lastKeyTypeName", typeName);
            console.log("目标键位已设置为: " + typeName);
        }
        toastLog("设置已保存");
        titleStr = "当前配置: " + getTargetTriple();
        ui.run(() => {
            controlWindow.musicTitleText.setText(titleStr);
        });
    });
    evt.on("posBtnClick", () => {
        //设置坐标
        type = readGlobalConfig("type",null);
        if (type == null || type == -1){
            type = (dialogs.select("异形屏适配：水滴屏 刘海屏 挖孔屏",["全面屏 或 无挖孔摄像头的平板","位于左侧","手机翻转后位于右侧"]));
            setGlobalConfig("type",type);
            console.log("异形屏设置为： "+ type);
        }
        if (type > -1){
            runClickPosSetup();
        }
    });
    evt.on("midiBtnClick", () => {
        //MIDI串流
        evt.emit("midiStreamStart");
    });
    evt.on("globalConfigBtnClick", () => {
        switch (dialogs.select("高级设置",
            ["📱异形屏设置",
             "🔍口袋琴自定义",
             "⏳延音设置",
             "⚠️检查权限",
            ])) {
            case -1:
                break;
            case 0:
                type = (dialogs.select("异形屏适配：水滴屏 刘海屏 挖孔屏",["全面屏 或 无挖孔摄像头的平板","位于左侧","手机翻转后位于右侧"]));
                if (type == -1){
                    break;
                }
                setGlobalConfig("type",type);
                console.log("异形屏设置为： "+ type);
                break;
            case 1://diy
                //切换配置至口袋琴自定义
                if (diy == false ){
                    setGlobalConfig("activeConfigName", "口袋琴自定义");
                    setGlobalConfig("lastConfigName", "口袋琴自定义");
                    gameProfile.setConfigByName("口袋琴自定义");
                    console.log("目标游戏已设置为: 口袋琴自定义");
                    gameProfile.setCurrentVariantDefault();
                    setGlobalConfig("lastVariantName", gameProfile.getCurrentVariantTypeName());
                    gameProfile.setCurrentKeyLayoutDefault();
                    setGlobalConfig("lastKeyTypeName", gameProfile.getCurrentKeyLayoutTypeName());
                    diy = true;
                }
                console.log("口袋琴自定义");

                if ((cachedKeyPos = readGlobalConfig("diyPos",null)) == null) {//首次使用初始化
                    cachedKeyPos = gameProfile.getAllKeyPositions();
                }
                let diyx = (dialogs.select("自定义坐标", ["第一行","第二行","第三行"]));
                if (diyx == -1 ){
                    console.log("取消选择");
                    break;
                }else {
                    let diyy = (dialogs.select("自定义坐标", ["1","2","3","4","5"]));
                    if (diyy == -1){
                        console.log("取消选择");
                        break;
                    }
                    diypos(diyx , diyy);
                }
                console.log("自定义完成");
                titleStr = "当前配置: " + getTargetTriple();
                ui.run(() => {
                    controlWindow.musicTitleText.setText(titleStr);
                });
                break;
            case 2://延音开关 自定义延音频率以适配不同游戏 及 防止低配手机卡顿
                if (diybool){
                    let sel =(dialogs.select("延音设置",["🔴已开启","高级选项"]));
                    if (sel == 0){
                        diybool = false;
                        break;
                    }else if (sel == 1){
                        let sel =(dialogs.select("高级选项",["频率时长：" + diytime + "ms","延迟：" + diysleeptime + "ms"]))
                        if (sel == 0){
                            diytime = dialogs.input("断音调低 建议范围：5-100" , diytime);
                            //输入非整型会报错，待完善diytime = diytime.replace(/[^\d]/g, "");//正则表达式过滤掉非数字字符
                            console.log("修改频率为" + diytime + "ms");
                            break;
                        }else if (sel ==1){
                            diysleeptime = dialogs.input("卡顿调高 断音调低 建议范围：0-50" , diysleeptime);
                            console.log("修改延迟为" + diysleeptime + "ms");
                            break;
                        }else {
                            console.log("取消选择");
                            break;
                        }
                    }else {
                        console.log("取消选择");
                        break;
                    }
                }else {
                    let sel =(dialogs.select("延音设置",["⭕已关闭","高级选项"]));
                    if (sel == 0){
                        diybool = true;
                        break;
                    }else if (sel == 1){
                        let sel =(dialogs.select("高级选项",["频率时长：" + diytime + "ms","延迟：" + diysleeptime + "ms"]))
                        if (sel == 0){
                            diytime = dialogs.input("断音调低 建议范围：5-100" , diytime);
                            //输入非整型会报错，待完善diytime = diytime.replace(/[^\d]/g, "");//正则表达式过滤掉非数字字符
                            console.log("修改频率为" + diytime + "ms");
                            break;
                        }else if (sel ==1){
                            diysleeptime = dialogs.input("卡顿调高 断音调低 建议范围：0-50" , diysleeptime);
                            console.log("修改延迟为" + diysleeptime + "ms");
                            break;
                        }else {
                            console.log("取消选择");
                            break;
                        }
                    }else {
                        console.log("取消选择");
                        break;
                    }
                }
            case 3:
                checkEnableAccessbility();
                break;
        };
    });
    evt.on("midiStreamStart", () => {
        const stream = setupMidiStream();
        if (stream == null) {
            toast("MIDI串流启动失败");
            return;
        }
        toast("MIDI串流已启动");
        operationMode = ScriptOperationMode.MIDIInputStreaming;
        ui.run(() => {
            controlWindow.musicTitleText.setText("MIDI串流中...");
        });
        stream.onDataReceived(function (datas) {
            const STATUS_COMMAND_MASK = 0xF0;
            const STATUS_CHANNEL_MASK = 0x0F;
            const STATUS_NOTE_OFF = 0x80;
            const STATUS_NOTE_ON = 0x90;
            let keyList = new Array();
            for (let data of datas) {
                console.log("data：    " + data);
                let cmd = data[0] & STATUS_COMMAND_MASK;
                //console.log("cmd：    " + cmd);
                let key = gameProfile.getKeyByPitch(data[1]);
                console.log("key：    " + key);
                switch(cmd){
                    case 144:
                        keyStates.set(key,true);
                        console.log("key：" + key + " TRUE !");
                        break;
                    case 128:
                        keyStates.set(key,false);
                        console.log("key：" + key + " FALSE");
                        break;
                }
                if (diybool == false && cmd == STATUS_NOTE_ON && data[2] != 0) { // velocity != 0
                    if (key != -1 && keyList.indexOf(key) === -1) keyList.push(key);
                }
            }
            if (diybool ==false){
                let gestureList = new Array();
                for (let j = 0; j < keyList.length; j++) { //遍历这个数组
                    let key = keyList[j];
                    if (diy && cachedKeyPos != null ){//自定义开启，且有改过坐标，否则默认位置
                        gestureList.push([0, 50, cachedKeyPos[key]]); 
                    }else {
                        gestureList.push([0, 50, gameProfile.getKeyPosition(key)]); 
                    }
                };
                if (gestureList.length > 10) gestureList.splice(9, gestureList.length - 10); //手势最多同时只能执行10个

                if (gestureList.length != 0) {
                    for (let player of selectedPlayers)
                        player.exec(gestureList);
                };
            }
        });

        threads.start(function(){
            while (true){//此线程一旦启动则不能关闭，否则线程失效且会重复启动
                if (diybool){
                    console.log(".........");
                    let keyList = new Array();
                    // 遍历键状态
                    keyStates.forEach((isPressed, keyNumber) => {
                    if (keyNumber != -1 && isPressed == true && keyList.indexOf(keyNumber) === -1) keyList.push(keyNumber);
                    //console.log("按键 " + keyNumber + "：" + (isPressed ? "按下" : "        释放"));
                    });
                    let gestureList = new Array();
                    for (let j = 0; j < keyList.length; j++) { //遍历这个数组
                        let key = keyList[j];
                        if (diy && cachedKeyPos != null ){//自定义开启，且有改过坐标，否则默认位置
                            gestureList.push([0, diytime, cachedKeyPos[key]]); 
                        }else {
                            gestureList.push([0, diytime, gameProfile.getKeyPosition(key)]); 
                        }
                    };
                    if (gestureList.length > 10) gestureList.splice(9, gestureList.length - 10); //手势最多同时只能执行10个
    
                    if (gestureList.length != 0) {
                        for (let player of selectedPlayers)
                            player.exec(gestureList);
                    };

                    sleep(diysleeptime);
                }else {
                    sleep(500);
                }
            }
        });

    });
    evt.on("exitApp", () => {
        exitApp();
    });

    function controlWindowUpdateLoop() {
        if (controlWindow == null) {
            return;
        }
    }
    setInterval(controlWindowUpdateLoop, 200);

    //悬浮按钮
    let fb = new FloatButton();
    fb.setIcon('@drawable/ic_library_music_black_48dp');
    fb.setTint('#ffff00');
    fb.setColor('#019581');
    fb.addItem('隐藏/显示主悬浮窗')
        .setIcon('@drawable/ic_visibility_black_48dp')
        .setTint('#FFFFFF')
        .setColor('#019581')
        .onClick((view, name) => {
            controlWindowSetVisibility(!controlWindowVisible);
            controlWindowVisible = !controlWindowVisible;
            //返回 true:保持菜单开启 false:关闭菜单
            return false;
        });
    fb.addItem('退出脚本')
        .setIcon('@drawable/ic_exit_to_app_black_48dp')
        .setTint('#FFFFFF')
        .setColor('#019581')
        .onClick((view, name) => {
            //fb.close();
            evt.emit("exitApp");
            return true;
        });
    fb.show();
}


function diypos(diyx,diyy){
    let indexkey =10- diyx * 5 + diyy;
    diyx++;
    diyy++;
    let pos = getPosInteractive("定位第" + diyx + "行 第" + diyy +"个按键",type);
    cachedKeyPos[indexkey] = [Math.round(pos.x), Math.round(pos.y)];
    console.log("自定义 第" + diyx + "行第" + diyy +"个按键 坐标：" + cachedKeyPos[indexkey])
    setGlobalConfig("diyPos",cachedKeyPos);
}

function start() {
    /**
     * see: https://github.com/kkevsekk1/AutoX/issues/672
     */
    if (runtimes.getCurrentRuntime() == runtimes.Runtime.AUTOXJS) {
        try {
            // console.log("宽度: " + device.width);
            //Java, 启动!!!
            let deviceClass = device.getClass();
            let widthField = deviceClass.getDeclaredField("width");
            let heightField = deviceClass.getDeclaredField("height");
            widthField.setAccessible(true);
            heightField.setAccessible(true);
            widthField.setInt(device, context.getResources().getDisplayMetrics().widthPixels);
            heightField.setInt(device, context.getResources().getDisplayMetrics().heightPixels);
            let rotationListener = new JavaAdapter(android.view.OrientationEventListener, {
                onOrientationChanged: function (orientation) {
                    widthField.setInt(device, context.getResources().getDisplayMetrics().widthPixels);
                    heightField.setInt(device, context.getResources().getDisplayMetrics().heightPixels);
                }
            }, context);
            rotationListener.enable();
        } catch (e) {
            console.warn("Workaround failed");
            console.error(e);
        }
    }

    //获取真实的应用名称
    const packageManager = context.getPackageManager();
    appName = packageManager.getApplicationLabel(context.getApplicationInfo()).toString();
    initialize();
    loadConfiguration();
    main();
    console.info("启动完成");
}

start();
