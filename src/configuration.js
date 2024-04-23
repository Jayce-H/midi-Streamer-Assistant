// Description: 配置系统
function Configuration() {
    const globalConfig = storages.create("midiAssistant_config");

    /**
     * 设置全局配置项
     * @param {string} key - 配置项的键名
     * @param {*} val - 配置项的值
     * @returns {number} - 返回0表示设置成功(总是成功?)
     */
    this.setGlobalConfig = function (key, val) {
        globalConfig.put(key, val);
        console.log("设置全局配置成功: " + key + " = " + val);
        return 0;
    };

    /**
     * 读取全局配置项
     * @param {string} key - 配置项的键名
     * @param {*} defaultValue - 配置项的默认值
     * @returns {*} - 返回配置项的值，如果不存在则返回默认值
     */
    this.readGlobalConfig = function (key, defaultValue) {
        let res = globalConfig.get(key, defaultValue);
        if (res == null) {
            return defaultValue;
        } else {
            return res;
        }
    };
}

module.exports = new Configuration();