function getPosInteractive(promptText,type) {
    let gotPos = false;
    //pos[0] 宽, pos[1] 高
    let pos = [];
    let fingerReleased = false;
    let confirmed = false;
    let fullScreenWindowRequestClose = false;
    let canvasDebugCounter = 0;
    console.log("type：" + type);
    if (type == 0 || type == 2){
        //全面屏和右侧异形屏不需要计算偏移量，宽高即为悬浮窗大小
        var deviceWidth = context.getResources().getDisplayMetrics().widthPixels;
        var deviceHeight = context.getResources().getDisplayMetrics().heightPixels;
        if(deviceWidth < deviceHeight){
            //反正都是横屏游戏，直接强制长的为宽，避免软件未旋转过去，导致宽高未更新
            deviceWidth = context.getResources().getDisplayMetrics().heightPixels;
            deviceHeight = context.getResources().getDisplayMetrics().widthPixels;
        }
    }else if(type == 1){
        var deviceWidth = device.width;//获取设备的才能计算偏移量
        var deviceHeight = device.height;
        if(deviceWidth < deviceHeight){
            //强制宽高
            deviceWidth = device.height;
            deviceHeight = device.width;
        }
        console.log("w"+deviceWidth);
        console.log("h"+deviceHeight);
    }
    

    console.log("getPosInteractive(): " + promptText);
    //提示和确认按钮的框
    let confirmWindow = floaty.rawWindow(
        <frame gravity="left|top">
            <vertical bg="#88ffffff">
                <text id="promptText" text="" textSize="14sp" />
                <button id="confirmBtn" style="Widget.AppCompat.Button.Colored" text="确定" />
                <button id="cancelBtn" style="Widget.AppCompat.Button.Colored" text="取消" />
            </vertical>
        </frame>
    );
    confirmWindow.setPosition(deviceWidth / 4, deviceHeight /2);
    confirmWindow.setTouchable(true);

    let fullScreenWindow = floaty.rawWindow(<canvas id="canv" w="*" h="*" />);
    fullScreenWindow.setTouchable(true);
    fullScreenWindow.setSize(-1, -1);
    fullScreenWindow.canv.setOnTouchListener(function (v, evt) {
        if (evt.getAction() == evt.ACTION_DOWN || evt.getAction() == evt.ACTION_MOVE) {
            gotPos = true;
            pos = [parseInt(evt.getRawX().toFixed(0)), parseInt(evt.getRawY().toFixed(0))];
        }
        if (evt.getAction() == evt.ACTION_UP) {
            fingerReleased = true;
        }
        return true;
    });
    fullScreenWindow.canv.on("draw", function (canvas) {
        const Color = android.graphics.Color;
        const Paint = android.graphics.Paint;
        const PorterDuff = android.graphics.PorterDuff;
        const w = canvas.getWidth();
        const h = canvas.getHeight();
        //const woffset = deviceWidth - w; //长边的偏移量
        const hoffset = deviceHeight - h; //短边的偏移量
        
        if (type == 1){
            const resources = context.getResources();
            const status_bar_height = resources.getDimensionPixelSize(
                resources.getIdentifier("status_bar_height", "dimen", "android")
            );//获取状态栏宽度，即为偏移量
            var woffset = status_bar_height;
        }else {
            var woffset = 0;
        }
        const centerCircleRadius = 10;
        let paint = new Paint();
        if (canvasDebugCounter != -1 && canvasDebugCounter < 60) {
            canvasDebugCounter++;
        } else if (canvasDebugCounter == 60) {
            console.log("canvas [长,短] = [" + w + "," + h + "]");
            console.log("device [长,短] = [" + deviceWidth + "," + deviceHeight + "]");
            console.log("offset [长,短] = [" + woffset + "," + hoffset + "]");
            canvasDebugCounter = -1;
        }

        //灰色背景
        canvas.drawColor(Color.parseColor("#3f000000"), PorterDuff.Mode.SRC);
        if (gotPos) {
            //画十字定位线
            paint.setStrokeWidth(2);
            paint.setARGB(255, 255, 255, 255);
            paint.setStyle(Paint.Style.STROKE);
            canvas.drawLine(0, pos[1] - hoffset, w, pos[1] - hoffset, paint);
            canvas.drawLine(pos[0] - woffset, 0, pos[0] - woffset, h, paint);

            //中心画一个空心圆
            paint.setStyle(Paint.Style.STROKE);
            canvas.drawCircle(pos[0] - woffset, pos[1] - hoffset, centerCircleRadius, paint);
        }
        if (fullScreenWindowRequestClose)
            sleep(1000);
    });


    ui.run(() => {
        confirmWindow.promptText.setText("请点击" + promptText);
        confirmWindow.confirmBtn.click(() => {
            confirmed = true;
        });
        confirmWindow.cancelBtn.click(() => {
            fingerReleased = false;
            gotPos = false;
            fullScreenWindow.setTouchable(true);
        });
    });

    while (!confirmed) {
        sleep(100);
        if (fingerReleased) {
            fullScreenWindow.setTouchable(false);
        }

        ui.run(function () {
            if (!gotPos) {
                confirmWindow.promptText.setText("请点击" + promptText);
            } else if (!fingerReleased) {
                confirmWindow.promptText.setText("当前坐标:" + pos.toString());
            } else {
                confirmWindow.promptText.setText("当前坐标:" + pos.toString() + ", 点击'确定'结束, 点击'取消'重新获取(坐标不准? 把手机转180度再试)");  //TODO: 修这个bug
            }
        });
    }

    fullScreenWindowRequestClose = true;
    sleep(100);
    fullScreenWindow.close();
    confirmWindow.close();

    console.log("End getPosInteractive(): " + pos.toString());

    return {
        "x": pos[0],
        "y": pos[1]
    }
}

module.exports = getPosInteractive;
