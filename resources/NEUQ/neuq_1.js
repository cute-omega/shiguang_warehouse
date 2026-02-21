// 为什么好几个支持的其他学校都是非本校学生写的？也帮我写一个呗
// TODO：可以抄一下MMPT的登陆检测逻辑

// 1. 显示一个公告信息弹窗
async function demoAlert() {
    try {
        console.log("即将显示公告弹窗...");
        const confirmed = await window.AndroidBridgePromise.showAlert(
            "注意",
            "本适配仅适配东北大学秦皇岛分校教务系统。导入前请确认已经登陆教务系统、课表页面正确显示、学年/学期无误。如有问题请联系开发者反馈。",
            "我知道了"
        );
        if (confirmed) {
            return true; // 成功时返回 true
        } else {
            return false; // 用户取消时返回 false
        }
    } catch (error) {
        console.error("显示公告弹窗时发生错误:", error);
        AndroidBridge.showToast("Alert：显示弹窗出错！" + error.message);
        return false; // 出现错误时也返回 false
    }
}

// 2. 从课表页面中提取课程数据
async function extractCoursesFromPage() {
    const iframe = document.querySelector('iframe');
    const lessons = [];
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const time = iframeDoc.querySelector('.kbappTimeXQText')
    const time_text = time.textContent;
    const dayCols = iframeDoc.querySelectorAll('.kbappTimetableDayColumnRoot');
    dayCols.forEach((dayCol, dayIndex) => {// 遍历每一列
        const timeSlots = dayCol.children;
        const day = dayIndex >= 1 ? dayIndex : 7; // 课表第一天为星期日

        let startSection = 0;
        let endSection = 0;
        /* TODO: 从头写起，以下是总校的
        for (let slot of timeSlots) {
            const flexValue = slot.style.flex;
            const nums = parseInt(flexValue.split(' ')[0]);
            startSection = endSection + 1;
            endSection = startSection + nums - 1;
            if (slot.classList.contains('kbappTimetableDayColumnConflictContainer')) {
                const courseItem = slot.querySelector('.kbappTimetableCourseRenderCourseItem');
                const infoTexts = courseItem.querySelectorAll('.kbappTimetableCourseRenderCourseItemInfoText');
                let name, details;

                infoTexts.forEach((text, idx) => {
                    if (idx === 0) name = text.textContent.trim();
                    else if (idx === 1) details = parseCourseDetails(text.textContent.trim());//weeks,teacher,position
                    else if (idx === 2) return
                });
                lessons.push({ name: name, teacher: details.teacher, position: details.position, day: day, startSection: startSection, endSection: endSection, weeks: details.weeks });
            }
        }
        */
        console.log("信息提取中");
    });

    return { lessons: lessons, time_text: time_text };
}

// 2.1 解析课程详情字符串，提取周次、教师和地点信息
function parseCourseDetails(detailStr) {
    /* TODO: 从头写起，以下是总校的
    // 匹配所有周次模式
    const weekPattern = /(\d+-\d+周(?:\([单双]\))?|\d+周(?:\([单双]\))?)/g;
    const weekMatches = detailStr.match(weekPattern);

    let weeks = '';
    let remaining = detailStr;

    if (weekMatches) {
        // 提取所有周次部分
        weeks = weekMatches.join(',');
        // 从原字符串中移除周次部分
        weekMatches.forEach(match => {
            remaining = remaining.replace(match, '');
        });
    }

    // 按空格分割剩余部分
    const parts = remaining.trim().split(/\s+/).filter(p => p);

    let teacher = '';
    let position = '';
    if (parts.length > 0) {
        teacher = parts[0];
        if (parts.length > 1) {
            position = parts.slice(1).join(' '); // 修正这一行
        }
    }

    // 清理教师名中的多余逗号
    teacher = teacher.replace(/^[,，]/, '').replace(/[,，]$/, '');

    return {
        weeks: parseWeeksString(weeks),
        teacher: teacher.trim(),
        position: position.trim()
    };
    */
}

// 2.2将周次文字提取成数组
function parseWeeksString(weeksStr) {
    if (!weeksStr) return [];

    const result = [];
    const weekParts = weeksStr.split(/[，,]/).map(part => part.trim());
    /* TODO: 从头写起，以下是总校的
    weekParts.forEach(part => {
        // 匹配单个数字周
        const singleMatch = part.match(/^(\d+)周(?:\(([单双])\))?$/);
        if (singleMatch) {
            const num = parseInt(singleMatch[1]);
            const type = singleMatch[2];
            if (!type || (type === '单' && num % 2 === 1) || (type === '双' && num % 2 === 0)) {
                result.push(num);
            }
            return;
        }

        // 匹配范围周
        const rangeMatch = part.match(/^(\d+)-(\d+)周(?:\(([单双])\))?$/);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = parseInt(rangeMatch[2]);
            const type = rangeMatch[3];

            if (!type) {
                for (let i = start; i <= end; i++) result.push(i);
            } else if (type === '单') {
                for (let i = start; i <= end; i++) {
                    if (i % 2 === 1) result.push(i);
                }
            } else if (type === '双') {
                for (let i = start; i <= end; i++) {
                    if (i % 2 === 0) result.push(i);
                }
            }
        }
    });

    return [...new Set(result)].sort((a, b) => a - b);
    */
}

// 2.3 解析学期字符串，返回对应的开学日期
function parseSemesterToDate(semesterStr) {
    // 使用正则表达式提取年份和学期信息
    const regex = /(\d{4})-(\d{4})学年(春季|秋季)学期/;
    const match = semesterStr.match(regex);
    /* TODO: 从头写起，以下是总校的
    if (!match) {
        throw new Error('学期字符串格式不正确，应为："XXXX-XXXX学年春季/秋季学期"');
    }

    const startYear = parseInt(match[1]);  // 前一个年份
    const endYear = parseInt(match[2]);    // 后一个年份
    const season = match[3];               // 春季或秋季

    // 验证年份格式是否正确（后一年份应比前一年份大1）
    if (endYear !== startYear + 1) {
        throw new Error('年份格式不正确，后一年份应比前一年份大1');
    }

    let resultDate;
    // TODO: 哈？开学日期不应该是第一个工作日吗？
    if (season === '春季') {
        // 春季学期：使用后一个年份的3月1日
        resultDate = `${endYear}-03-01`;
    } else if (season === '秋季') {
        // 秋季学期：使用前一个年份的9月1日
        resultDate = `${startYear}-09-01`;
    } else {
        throw new Error('学期类型不正确，应为"春季"或"秋季"');
    }
    */
    return resultDate;
}

// 3. 导入课程数据
async function SaveCourses(lessons) {
    console.log("正在准备测试课程数据...");
    const testCourses = lessons;

    try {
        console.log("正在尝试导入课程...");
        const result = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(testCourses));
        if (result === true) {
            console.log("课程导入成功！");
        } else {
            console.log("课程导入未成功，结果：" + result);
            AndroidBridge.showToast("测试课程导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入课程时发生错误:", error);
        AndroidBridge.showToast("导入课程失败: " + error.message);
    }
}

// 4. 导入预设时间段
async function importPresetTimeSlots() {
    console.log("正在准备预设时间段数据...");
    const presetTimeSlots = [
        // 为什么总校可以不用早八（他们8:30第一节课）TAT
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:50", "endTime": "09:35" },
        { "number": 3, "startTime": "10:05", "endTime": "10:50" },
        { "number": 4, "startTime": "10:55", "endTime": "11:40" },
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        { "number": 6, "startTime": "14:50", "endTime": "15:35" },
        { "number": 7, "startTime": "16:05", "endTime": "16:50" },
        { "number": 8, "startTime": "16:55", "endTime": "17:40" },
        { "number": 9, "startTime": "18:40", "endTime": "19:25" },
        { "number": 10, "startTime": "19:30", "endTime": "20:15" },
        { "number": 11, "startTime": "20:25", "endTime": "21:10" },
        { "number": 12, "startTime": "21:15", "endTime": "22:00" },
    ];

    try {
        console.log("正在尝试导入预设时间段...");
        const result = await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result === true) {
            console.log("预设时间段导入成功！");
        } else {
            console.log("预设时间段导入未成功，结果：" + result);
            window.AndroidBridge.showToast("测试时间段导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入时间段时发生错误:", error);
        window.AndroidBridge.showToast("导入时间段失败: " + error.message);
    }
}

// 5. 导入课表配置
async function SaveConfig(time_text) {
    console.log("正在准备配置数据...");
    startDate = parseSemesterToDate(time_text);
    // 注意：只传入要修改的字段，其他字段（如 semesterTotalWeeks）会使用 Kotlin 模型中的默认值
    const courseConfigData = {
        "semesterStartDate": startDate,
        "semesterTotalWeeks": 20, // 似乎没那么长，但反正20周够用
        "defaultClassDuration": 45, // 一节课当然都是45分钟
        "defaultBreakDuration": 5, // 
        "firstDayOfWeek": 1
    };

    try {
        console.log("正在尝试导入课表配置...");
        const configJsonString = JSON.stringify(courseConfigData);

        const result = await window.AndroidBridgePromise.saveCourseConfig(configJsonString);

        if (result === true) {
            console.log("课表配置导入成功！");
        } else {
            console.log("课表配置导入未成功，结果：" + result);
            AndroidBridge.showToast("测试配置导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入配置时发生错误:", error);
        AndroidBridge.showToast("导入配置失败: " + error.message);
    }
}

/**
 * 编排这些异步操作，并在用户取消时停止后续执行。
 */
async function runAllDemosSequentially() {
    AndroidBridge.showToast("所有演示将按顺序开始...");
    // 1. 提示公告
    const alertResult = await demoAlert();
    if (!alertResult) {
        console.log("用户取消了 Alert 演示，停止后续执行。");
        return; // 用户取消，立即退出函数
    }

    console.log("所有弹窗演示已完成。");
    AndroidBridge.showToast("所有弹窗演示已完成！");


    // 以下是数据导入，与用户交互无关，可以继续
    const PageInfo = await extractCoursesFromPage();//从课表页面中提取课程数据
    const lessons = PageInfo.lessons;
    const time_text = PageInfo.time_text;
    await SaveCourses(lessons);//保存课程数据到数据库
    await importPresetTimeSlots();//导入预设时间槽
    await SaveConfig(time_text);//保存底层配置

    // 发送最终的生命周期完成信号
    AndroidBridge.notifyTaskCompletion();
}

// 启动所有演示
runAllDemosSequentially();