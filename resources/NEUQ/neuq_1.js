// 为什么好几个支持的其他学校都是非本校学生写的？也帮我写一个呗
// 增强：可以抄一下MMPT的登陆检测逻辑

// 1. 显示一个公告信息弹窗
async function demoAlert() {
  try {
    console.log("即将显示公告弹窗...");
    const confirmed = await window.AndroidBridgePromise.showAlert(
      "注意",
      "本适配仅适配东北大学秦皇岛分校教务系统。导入前请确认已经登陆教务系统、课表页面正确显示、学年/学期无误。如有问题请联系开发者反馈。",
      "我知道了",
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
  // 兼容直接在页面或在 iframe 内的表格
  const doc =
    typeof iframe !== "undefined" &&
    (iframe.contentDocument ||
      (iframe.contentWindow && iframe.contentWindow.document))
      ? iframe.contentDocument || iframe.contentWindow.document
      : document;

  const table = doc.querySelector("#manualArrangeCourseTable");
  const lessons = [];
  if (!table) {
    console.warn("未找到 #manualArrangeCourseTable 表格");
    return { lessons: [], time_text: "" };
  }

  // 提取表头星期数量（减去第一列的节次说明）
  const headerThs = table.querySelectorAll("thead th");
  const cols = Math.max(0, headerThs.length - 1);

  // 构建占位表格（rows x cols），用于处理 rowspan/colspan
  const tbodyRows = Array.from(table.querySelectorAll("tbody tr"));
  const rows = tbodyRows.length;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));

  // 填充 grid：跳过每行第一个单元（节次描述），从第二个单元开始放置
  for (let r = 0; r < rows; r++) {
    const tr = tbodyRows[r];
    // 使用真实 cells，跳过第一个 cell（节次列）
    const cells = Array.from(tr.children).filter(
      (n) => n.tagName.toLowerCase() === "td",
    );
    // find index of first data cell (skip period label)
    let cellIdx = 0;
    // 如果第一 td 是节次说明，则从 1 开始
    if (cells.length > 0) {
      // heuristic: first td often has 色彩或“第一节”文字，称为节次说明
      // 若它包含“第”字或“节”字，则认为是节次描述
      const firstText = (cells[0].innerText || "").trim();
      if (
        /第.+节/.test(firstText) ||
        /节次/.test(firstText) ||
        firstText === ""
      ) {
        cellIdx = 1;
      } else {
        // 保守处理：仍假定第一为节次
        cellIdx = 1;
      }
    }

    let colPointer = 0;
    for (let ci = cellIdx; ci < cells.length; ci++) {
      const cell = cells[ci];
      // 找到当前行第一个空闲列
      while (colPointer < cols && grid[r][colPointer] !== null) colPointer++;
      if (colPointer >= cols) break;

      const rowspan = parseInt(cell.getAttribute("rowspan") || "1", 10);
      const colspan = parseInt(cell.getAttribute("colspan") || "1", 10);

      // 在 grid 中标记占用
      for (let rr = r; rr < Math.min(rows, r + rowspan); rr++) {
        for (
          let cc = colPointer;
          cc < Math.min(cols, colPointer + colspan);
          cc++
        ) {
          grid[rr][cc] = {
            cell: cell,
            startRow: r,
            startCol: colPointer,
            rowspan: rowspan,
            colspan: colspan,
          };
        }
      }

      colPointer += colspan;
    }
  }

  // 逐格读取 grid 中的起始单元，解析课程
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const entry = grid[r][c];
      if (!entry) continue;
      // 仅处理起始单元（避免重复）
      if (entry.startRow !== r || entry.startCol !== c) continue;

      const td = entry.cell;
      const title =
        td.getAttribute("title") || td.innerHTML || td.innerText || "";
      const raw = title.trim();
      if (!raw) continue;

      // 解析单元格中可能包含的多门课程。
      // 优先按 ';;' 分隔（有些 title 使用该分隔），否则按 <br> 换行分解并基于行型态配对：
      // 单门课程通常为: [课程名(包含教师)] <br><br> [周次与地点]
      // 多门课程之间通常以单个 <br> 相连。我们将把行合成为 name/detail 对。
      let parts = raw
        .split(";;")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length >= 1) {
        // 有时单个 ';;' 片段内部还用 ';' 连接多个条目，扁平化处理
        parts = parts
          .map((p) => p.split(";"))
          .flat()
          .map((s) => s.trim())
          .filter(Boolean);
      }

      if (parts.length < 2) {
        // 将所有 <br> 转为换行并分行，但保留顺序
        const normalized = (td.innerHTML || "").replace(/<br\s*\/?>/gi, "\n");
        const rawLines = normalized
          .split("\n")
          .map((s) => s.replace(/<[^>]+>/g, "").trim());
        const lines = rawLines; // 保留空行以识别双换行

        parts = [];
        for (let i = 0; i < lines.length; i++) {
          const line = (lines[i] || "").trim();
          if (!line) continue; // 空行忽略

          const isDetailLike = (s) =>
            /^\(?\d{1,2}(-\d{1,2})?/.test(s) ||
            /^\(.*\)/.test(s) ||
            (/\d/.test(s) && /[,，、]/.test(s));

          // 向前查找下一个非空行（最多查找 4 行），以支持多次 <br> 导致的空行
          let found = false;
          for (let j = i + 1; j <= Math.min(i + 4, lines.length - 1); j++) {
            const cand = (lines[j] || "").trim();
            if (!cand) continue; // 跳过空行
            if (isDetailLike(cand)) {
              parts.push(line);
              parts.push(cand);
              i = j; // 跳过到 detail 行
              found = true;
            }
            // 无论是否 detail-like，遇到第一个非空行后都停止查找（已处理或判断为非 detail）
            break;
          }

          if (!found) {
            parts.push(line);
          }
        }
      }

      // 仅“括号内数字开头”的行才视为周次+地点；其他行视为课程名补充说明
      const isWeekDetailLine = (s) =>
        /^\s*\(?\d{1,2}(?:-\d{1,2})?/.test(s || "");
      const normalizeNameSuffix = (s) =>
        (s || "").replace(/^\s*[（(]+\s*|\s*[)）]+\s*$/g, "").trim();

      // 如果 parts 仍然是交替模式，确保我们有 name/detail 对序列：当检测到 name 后寻找最近的 detail
      const tokens = parts.slice();
      const paired = [];
      const isNameLike = (s) => /[\u4e00-\u9fa5]+/.test(s) && /\(/.test(s);
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (isNameLike(t)) {
          // look ahead for detail; 中间非周次行拼接为课程名后缀
          let nameWithSuffix = t;
          let detail = "";
          let j = i + 1;
          while (j < tokens.length) {
            const cand = tokens[j];
            if (isWeekDetailLine(cand)) {
              detail = cand;
              j++;
              break;
            }

            // 下一条已经是新的课程名，则当前课程无 detail
            if (isNameLike(cand)) break;

            // 否则按课程名说明后缀处理
            const suffix = normalizeNameSuffix(cand);
            if (suffix) {
              nameWithSuffix = `${nameWithSuffix} ${suffix}`.trim();
            }
            j++;
          }

          paired.push([nameWithSuffix, detail]);
          i = j - 1;
        } else if (isWeekDetailLine(t)) {
          // orphan detail without preceding name — skip or attach to previous
          if (paired.length > 0 && !paired[paired.length - 1][1]) {
            paired[paired.length - 1][1] = t;
          } else {
            // treat as nameless detail
            paired.push(["", t]);
          }
        } else {
          // neither clearly name nor detail: 视为说明文本
          const suffix = normalizeNameSuffix(t);
          if (paired.length > 0 && suffix && !paired[paired.length - 1][1]) {
            paired[paired.length - 1][0] =
              `${paired[paired.length - 1][0]} ${suffix}`.trim();
          } else if (i + 1 < tokens.length && isWeekDetailLine(tokens[i + 1])) {
            paired.push([suffix || t, tokens[i + 1]]);
            i++;
          } else {
            paired.push([suffix || t, ""]);
          }
        }
      }

      // 如果 parts 是交替的（课程名, 详情, 课程名, 详情...），按对儿处理
      for (const [namePart, detailPart] of paired) {
        const nameClean = (namePart || "").replace(/<[^>]+>/g, "").trim();
        const detailClean = (detailPart || "").replace(/<[^>]+>/g, "").trim();
        const parsed = parseCourseDetails(nameClean, detailClean);
        if (!parsed) continue;
        const lesson = {
          name: parsed.name || "",
          teacher: parsed.teacher || "",
          location: parsed.location || "",
          weeks: parsed.weeks || [],
          dayOfWeek: c + 1,
          startSection: r + 1,
          sectionCount: entry.rowspan || 1,
        };
        lessons.push(lesson);
      }
    }
  }

  // 尝试从页面中匹配学期字符串，如“2023-2024学年秋季学期”
  let time_text = "";
  const bodyText = doc.body ? doc.body.innerText || "" : "";
  const m = bodyText.match(/\d{4}-\d{4}学年(春季|秋季)学期/);
  if (m) time_text = m[0];

  return { lessons: lessons, time_text: time_text };
}

// 2.1 解析课程详情字符串，提取周次、教师和地点信息
function parseCourseDetails(nameStr, detailStr) {
  // nameStr 例如："数学建模(3020113021.01) (王军)"
  // detailStr 例如："(9-16,工学馆511(学校本部)"
  const result = { name: "", teacher: "", weeks: [], location: "" };
  if (!nameStr && !detailStr) return result;

  // 解析课程名
  // 优先匹配“课程代码 + (教师)”的结构，避免说明后缀影响教师识别
  let normalizedName = (nameStr || "").trim();
  const teacherAfterCodeMatch = normalizedName.match(
    /\(\d[^()]*\)\s*\(([^()]+)\)/,
  );
  if (teacherAfterCodeMatch) {
    result.teacher = teacherAfterCodeMatch[1].trim();
    normalizedName = normalizedName.replace(
      /\(\d[^()]*\)\s*\(([^()]+)\)/,
      (m) => m.replace(/\s*\([^()]+\)\s*$/, ""),
    );
  } else {
    // 兜底：若末尾是教师括号，按旧逻辑处理
    const teacherMatch = normalizedName.match(/\(([^()]+)\)\s*$/);
    if (teacherMatch) {
      result.teacher = teacherMatch[1].trim();
      normalizedName = normalizedName.replace(/\([^()]*\)\s*$/, "").trim();
    }
  }
  result.name = normalizedName.replace(/\s+/g, " ").trim();

  // 从 detailStr 中提取周次与地点，常见格式例如："(9-16,工学馆511(学校本部)" 或 "9-16,工学馆511"
  const rawDetail = (detailStr || "").trim();
  const isWeekDetailLine = (s) => /^\s*\(?\d{1,2}(?:-\d{1,2})?/.test(s || "");

  // 非数字开头的 detail 视为课程说明后缀，不当作地点
  if (rawDetail && !isWeekDetailLine(rawDetail)) {
    const suffix = rawDetail.replace(/^[\(\s]+|[\)\s]+$/g, "").trim();
    if (suffix) {
      result.name = `${result.name} ${suffix}`.replace(/\s+/g, " ").trim();
    }
    return result;
  }

  let s = rawDetail.replace(/^[\(\s]+|[\)\s]+$/g, ""); // 去除外层括号或空白

  let weeks = [];
  let loc = "";
  if (s) {
    const parts = s
      .split(/[,，]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2 && /\d/.test(parts[0])) {
      weeks = parseWeeksString(parts[0]);
      loc = parts.slice(1).join(",").trim();
    } else {
      // 尝试在字符串中提取周次片段，再把剩余作为地点
      // 支持带单/双标注的周次，如 "1-5单" 或 空格分隔的多段 "6 8-14 16-17"
      const weekTokenRegex = /\d{1,2}(?:-\d{1,2})?(?:单|双|单周|双周)?/g;
      const weekMatches = s.match(weekTokenRegex) || [];
      if (weekMatches.length) {
        // 将匹配到的周次片段合并传给解析器（解析器支持空格/逗号分隔）
        weeks = parseWeeksString(weekMatches.join(" "));
        // 去掉周次片段和括号后剩余部分作为地点
        loc = s
          .replace(weekTokenRegex, "")
          .replace(/[()]/g, "")
          .replace(/[,:;；，。\s]+/g, " ")
          .trim();
      } else {
        // 既没有明显周次，也没有逗号分隔：将整个字符串视为地点
        loc = s;
      }
    }
  }
  result.weeks = Array.from(new Set(weeks)).sort((a, b) => a - b);
  result.location = loc;

  return result;
}

// 2.2将周次文字提取成数组
function parseWeeksString(weeksStr) {
  if (!weeksStr) return [];

  const result = [];
  // 支持格式："1-8", "3,5,7", "1,3-6" 等
  // 允许使用空格或逗号/分号作为分隔符，例如 "6 8-14 16-17" 或 "1,3-6"
  // 首先保留数字、连字符和常见分隔符，去掉多余文字（如“周”）
  const cleaned = (weeksStr || "").replace(/[周次\(\)\[\]]/g, "").trim();

  // 按空格、逗号、分号或中文分隔符分割为 token
  const parts = cleaned.split(/[\s;,，、;；]+/).filter(Boolean);

  parts.forEach((p) => {
    p = p.trim();
    if (!p) return;

    // 检测单/双标注
    const parityMatch = p.match(/(单周|双周|单|双)$/);
    let parity = null;
    if (parityMatch) {
      parity = parityMatch[1].indexOf("单") === 0 ? "odd" : "even";
      p = p.slice(0, p.length - parityMatch[1].length).trim();
    }

    // 如果去掉标注后为空，跳过
    if (!p) return;

    if (/^\d+-\d+$/.test(p)) {
      const [s, e] = p.split("-").map((x) => parseInt(x, 10));
      if (!isNaN(s) && !isNaN(e) && e >= s) {
        for (let i = s; i <= e; i++) {
          if (parity === "odd" && i % 2 === 0) continue;
          if (parity === "even" && i % 2 === 1) continue;
          result.push(i);
        }
      }
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (parity === "odd" && n % 2 === 0) return;
      if (parity === "even" && n % 2 === 1) return;
      result.push(n);
    } else {
      // 兜底：提取片段内的所有数字/范围
      const inner = p.match(/\d{1,2}(?:-\d{1,2})?/g) || [];
      inner.forEach((tok) => {
        if (/^\d+-\d+$/.test(tok)) {
          const [s, e] = tok.split("-").map((x) => parseInt(x, 10));
          if (!isNaN(s) && !isNaN(e) && e >= s) {
            for (let i = s; i <= e; i++) {
              if (parity === "odd" && i % 2 === 0) continue;
              if (parity === "even" && i % 2 === 1) continue;
              result.push(i);
            }
          }
        } else if (/^\d+$/.test(tok)) {
          const n = parseInt(tok, 10);
          if (parity === "odd" && n % 2 === 0) return;
          if (parity === "even" && n % 2 === 1) return;
          result.push(n);
        }
      });
    }
  });

  return Array.from(new Set(result)).sort((a, b) => a - b);
}

// 2.3 解析学期字符串，返回对应的开学日期
function parseSemesterToDate(semesterStr) {
  // 使用正则表达式提取年份和学期信息
  const regex = /(\d{4})-(\d{4})学年(春季|秋季)学期/;
  const match = semesterStr.match(regex);
  if (!match) {
    // 无法解析则返回今日日期字符串（兼容调用方）
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  const startYear = parseInt(match[1], 10);
  const season = match[3];
  let resultDate;
  if (season === "秋季") {
    // 秋季学期以当年9月的第一个周一作为起始
    let date = new Date(startYear, 8, 1); // 9月1日
    let day = date.getDay();
    // 0=周日, 1=周一, ... 6=周六
    let offset = day === 0 ? 1 : 8 - day;
    resultDate = new Date(startYear, 8, 1 + offset);
  } else {
    // 春季学期以次年3月的第一个周一作为起始
    const endYear = parseInt(match[2], 10);
    let date = new Date(endYear, 2, 1); // 3月1日
    let day = date.getDay();
    let offset = day === 0 ? 1 : 8 - day;
    resultDate = new Date(endYear, 2, 1 + offset);
  }

  return resultDate.toISOString().slice(0, 10);
}

// 3. 导入课程数据
async function SaveCourses(lessons) {
  console.log("正在准备测试课程数据...");
  // 将内部解析格式转换为应用要求的 CourseJsonModel 格式（参考 guide.md）
  function toCourseJson(lesson) {
    const rawStart = Number(lesson.startSection) || 1;
    // 修正：页面行索引原本已是 1-based，但导出应以真实节次为准，示例显示所有节次偏大 1
    const startSection = Math.max(1, rawStart - 1);
    const sectionCount = Number(lesson.sectionCount) || 1;
    const endSection = startSection + sectionCount - 1;

    // 补全 position 中可能缺失的右括号（如 "工学馆511(学校本部" -> "工学馆511(学校本部)"）
    function balanceRightParens(s) {
      if (!s) return s;
      const open = (s.match(/\(/g) || []).length;
      const close = (s.match(/\)/g) || []).length;
      if (open > close) {
        return s + ")".repeat(open - close);
      }
      return s;
    }

    let positionRaw = lesson.location || lesson.position || "";
    positionRaw = positionRaw.trim();
    positionRaw = balanceRightParens(positionRaw);

    return {
      name: lesson.name || "",
      teacher: lesson.teacher || "",
      position: positionRaw,
      day: Number(lesson.dayOfWeek || lesson.day || 1),
      startSection: startSection,
      endSection: endSection,
      weeks: Array.isArray(lesson.weeks) ? lesson.weeks.map(Number) : [],
      isCustomTime: false,
    };
  }

  const testCourses = (lessons || []).map(toCourseJson);

  try {
    console.log("正在尝试导入课程... 共", testCourses.length, "条");
    const result = await window.AndroidBridgePromise.saveImportedCourses(
      JSON.stringify(testCourses),
    );
    if (result === true) {
      console.log("课程导入成功！");
      return true;
    } else {
      console.log("课程导入未成功，结果：" + result);
      AndroidBridge.showToast("测试课程导入失败，请查看日志。");
      return false;
    }
  } catch (error) {
    console.error("导入课程时发生错误:", error);
    AndroidBridge.showToast(
      "导入课程失败: " + (error && error.message ? error.message : error),
    );
    return false;
  }
}

// 4. 导入预设时间段
async function importPresetTimeSlots() {
  console.log("正在准备预设时间段数据...");
  const presetTimeSlots = [
    // 为什么总校可以不用早八（他们8:30第一节课）TAT
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "10:05", endTime: "10:50" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:50", endTime: "15:35" },
    { number: 7, startTime: "16:05", endTime: "16:50" },
    { number: 8, startTime: "16:55", endTime: "17:40" },
    { number: 9, startTime: "18:40", endTime: "19:25" },
    { number: 10, startTime: "19:30", endTime: "20:15" },
    { number: 11, startTime: "20:25", endTime: "21:10" },
    { number: 12, startTime: "21:15", endTime: "22:00" },
  ];

  try {
    console.log("正在尝试导入预设时间段...");
    const result = await window.AndroidBridgePromise.savePresetTimeSlots(
      JSON.stringify(presetTimeSlots),
    );
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
  const startDate = parseSemesterToDate(time_text);
  // 注意：只传入要修改的字段，其他字段（如 semesterTotalWeeks）会使用 Kotlin 模型中的默认值
  // 不自动返回 semesterStartDate，交由用户根据校历自行设置
  const courseConfigData = {
    semesterTotalWeeks: 20, // 似乎没那么长，但反正20周够用
    defaultClassDuration: 45, // 一节课当然都是45分钟
    defaultBreakDuration: 5, // 只有5分钟下课 TAT
    firstDayOfWeek: 1, // 一周当然从周一开始
  };

  try {
    console.log("正在尝试导入课表配置...");
    const configJsonString = JSON.stringify(courseConfigData);

    const result =
      await window.AndroidBridgePromise.saveCourseConfig(configJsonString);

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
  const PageInfo = await extractCoursesFromPage(); //从课表页面中提取课程数据
  const lessons = PageInfo.lessons;
  const time_text = PageInfo.time_text;
  await SaveCourses(lessons); //保存课程数据到数据库
  await importPresetTimeSlots(); //导入预设时间槽
  await SaveConfig(time_text); //保存底层配置

  // 发送最终的生命周期完成信号
  AndroidBridge.notifyTaskCompletion();
}

// 启动所有演示
runAllDemosSequentially();
