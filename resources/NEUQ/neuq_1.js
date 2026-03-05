// 增强：可以抄一下MMPT的登陆检测逻辑

async function raiseError(message, error = undefined) {
  console.error(message, error);
  await window.AndroidBridgePromise.showAlert(
    "出错了",
    message + " " + (error && error.message ? error.message : ""),
    "我知道了",
  );
}

async function raiseWarning(message, warning = undefined) {
  console.warn(message, warning);
  AndroidBridge.showToast(
    "警告：" +
      message +
      " " +
      (warning && warning.message ? warning.message : ""),
  );
}

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
    await raiseWarning("显示公告弹窗时发生错误:", error);
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
    await raiseError(
      "当前页面未识别到课程表格，无法提取课程数据。请确认已经登陆教务系统并打开了课表页面。",
    );
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

  // 仅“括号内以数字开头”的行才视为周次+地点详情行
  const isWeekLocationLine = (s) =>
    /^\(?\s*\d{1,2}(?:\s*-\s*\d{1,2})?/.test((s || "").trim());

  // 将“课程说明行”追加到课程名后缀，并尽量保持教师尾注在最后，便于后续提取教师
  const appendNameSuffix = (baseName, suffixLines) => {
    const suffix = (suffixLines || [])
      .map((line) => {
        const t = (line || "").trim();
        if (!t) return "";
        // 非周次行若是整行括号，去掉外层括号再拼接
        if (/^\(.*\)$/.test(t) && !isWeekLocationLine(t)) {
          return t.slice(1, -1).trim();
        }
        return t;
      })
      .filter(Boolean)
      .join(" ");

    if (!suffix) return (baseName || "").trim();

    const base = (baseName || "").trim();
    const teacherTail = base.match(/\(([^()]+)\)\s*$/);
    if (!teacherTail) {
      return [base, suffix].filter(Boolean).join(" ").trim();
    }

    const teacherPart = teacherTail[0].trim();
    const nameWithoutTeacher = base.replace(/\([^()]+\)\s*$/, "").trim();
    return [nameWithoutTeacher, suffix, teacherPart]
      .filter(Boolean)
      .join(" ")
      .trim();
  };

  // 将单元格文本拆成 [name, detail] 对。detail 必须是“括号内以数字开头”的行。
  const pairCourseLines = (td, rawTitle) => {
    const normalized = (rawTitle || td.innerHTML || td.innerText || "")
      .replace(/;;/g, "\n")
      .replace(/<br\s*\/?>/gi, "\n");

    const lines = normalized
      .split("\n")
      .flatMap((s) => s.split(";"))
      .map((s) => s.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);

    const paired = [];
    let currentName = "";
    let nameSuffixLines = [];

    for (const line of lines) {
      if (isWeekLocationLine(line)) {
        const finalName = appendNameSuffix(currentName, nameSuffixLines);
        paired.push([finalName, line]);
        currentName = "";
        nameSuffixLines = [];
        continue;
      }

      // 非周次行：第一行作为课程名，后续行作为课程说明后缀
      if (!currentName) {
        currentName = line;
      } else {
        nameSuffixLines.push(line);
      }
    }

    // 兜底：没有匹配到周次+地点时，仍保留课程名
    if (currentName || nameSuffixLines.length > 0) {
      paired.push([appendNameSuffix(currentName, nameSuffixLines), ""]);
    }

    return paired;
  };

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

      const paired = pairCourseLines(td, raw);

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

  // 返回前去重：名称、教师、周次、地点与时间信息完全一致才视为重复
  const dedupeLessons = (items) => {
    const seen = new Set();
    const unique = [];
    for (const item of items || []) {
      const weeks = Array.isArray(item.weeks)
        ? Array.from(
            new Set(item.weeks.map((w) => Number(w)).filter((w) => !isNaN(w))),
          ).sort((a, b) => a - b)
        : [];

      const keyObj = {
        name: (item.name || "").trim(),
        teacher: (item.teacher || "").trim(),
        location: (item.location || "").trim(),
        weeks: weeks,
        dayOfWeek: Number(item.dayOfWeek) || 0,
        startSection: Number(item.startSection) || 0,
        sectionCount: Number(item.sectionCount) || 0,
      };
      const key = JSON.stringify(keyObj);
      if (seen.has(key)) continue;
      seen.add(key);

      unique.push({
        ...item,
        weeks: weeks,
      });
    }
    return unique;
  };

  const uniqueLessons = dedupeLessons(lessons);

  return { lessons: uniqueLessons, time_text: time_text };
}

// 2.1 解析课程详情字符串，提取周次、教师和地点信息
function parseCourseDetails(nameStr, detailStr) {
  // nameStr 例如："数学建模(3020113021.01) (王军)"
  // detailStr 例如："(9-16,工学馆511(学校本部)"
  const result = { name: "", teacher: "", weeks: [], location: "" };
  if (!nameStr && !detailStr) return result;

  // 解析课程名
  // 先尝试提取教师：通常以最后一对小括号表示教师
  const teacherMatch = nameStr.match(/\(([^()]+)\)\s*$/);
  if (teacherMatch) {
    result.teacher = teacherMatch[1].trim();
    // 去掉尾部的 (教师)
    result.name = nameStr.replace(/\([^()]*\)\s*$/, "").trim();
  } else {
    result.name = nameStr.trim();
  }

  // 从 detailStr 中提取周次与地点，常见格式例如："(9-16,工学馆511(学校本部)" 或 "9-16,工学馆511"
  const rawDetail = (detailStr || "").trim();
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
      await raiseError("课程导入未成功，结果：" + new String(result));
      return false;
    }
  } catch (error) {
    await raiseError("导入课程时发生错误:", error);
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
      await raiseError("预设时间段导入未成功，结果：" + new String(result));
    }
  } catch (error) {
    await raiseError("导入时间段时发生错误:", error);
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
      await raiseError("课表配置导入未成功，结果：" + new String(result));
    }
  } catch (error) {
    await raiseError("导入配置时发生错误:", error);
  }
}

/**
 * 编排这些异步操作，并在用户取消时停止后续执行。
 */
async function runAllDemosSequentially() {
  // 1. 提示公告
  const alertResult = await demoAlert();
  if (!alertResult) {
    console.log("用户取消了 Alert 演示，停止后续执行。");
    return; // 用户取消，立即退出函数
  }

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
