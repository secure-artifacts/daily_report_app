import json
import os
import re
import sys
from copy import deepcopy
from datetime import date, datetime
from pathlib import Path

from PyQt6.QtCore import QTimer, Qt
from PyQt6.QtGui import QAction, QFont
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QDateEdit,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSplitter,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


APP_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_FILE = APP_DIR / "report_data.json"
SETTINGS_FILE = APP_DIR / "settings.json"


DEFAULT_DATA = {
    "version": 1,
    "updated_at": "",
    "quota": 3.0,
    "rules": {
        "视频": 1.0,
        "音频": 1.0,
        "字幕": 0.25,
        "图片": 0.0,
    },
    "members": ["成员A"],
    "records": {},
}


def today_key():
    return date.today().isoformat()


def safe_float(value, default=0.0):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def load_json(path, default):
    if not path.exists():
        return deepcopy(default)
    try:
        with path.open("r", encoding="utf-8") as f:
            loaded = json.load(f)
    except (json.JSONDecodeError, OSError):
        backup = path.with_suffix(".broken.json")
        try:
            path.replace(backup)
        except OSError:
            pass
        return deepcopy(default)
    merged = deepcopy(default)
    if isinstance(loaded, dict):
        merged.update(loaded)
        merged["rules"] = {**default["rules"], **loaded.get("rules", {})}
        merged["members"] = loaded.get("members") or default["members"]
        merged["records"] = loaded.get("records") or {}
    return merged


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = datetime.now().isoformat(timespec="seconds")
    temp = path.with_suffix(".tmp")
    with temp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    temp.replace(path)


def load_settings():
    return load_json(SETTINGS_FILE, {"data_file": str(DEFAULT_DATA_FILE)})


def save_settings(settings):
    save_json(SETTINGS_FILE, settings)


class TextDialog(QDialog):
    def __init__(self, title, prompt, parent=None):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setMinimumWidth(460)
        layout = QVBoxLayout(self)
        label = QLabel(prompt)
        label.setWordWrap(True)
        self.text = QTextEdit()
        self.text.setPlaceholderText("写在这里...")
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(label)
        layout.addWidget(self.text)
        layout.addWidget(buttons)

    def value(self):
        return self.text.toPlainText().strip()


class DailyReportApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.settings = load_settings()
        self.data_file = Path(self.settings.get("data_file") or DEFAULT_DATA_FILE)
        self.data = load_json(self.data_file, DEFAULT_DATA)
        self.last_mtime = self._mtime()
        self.current_member = self.data["members"][0]
        self.current_date = today_key()
        self.loading = False

        self.setWindowTitle("小组报数日记")
        self.resize(1180, 780)
        self.setMinimumSize(760, 520)
        self._build_ui()
        self._apply_style()
        self._refresh_everything()

        self.sync_timer = QTimer(self)
        self.sync_timer.setInterval(1800)
        self.sync_timer.timeout.connect(self._maybe_reload_external_changes)
        self.sync_timer.start()

    def _mtime(self):
        try:
            return self.data_file.stat().st_mtime
        except OSError:
            return 0

    def _build_ui(self):
        root = QWidget()
        outer = QVBoxLayout(root)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
        self.setCentralWidget(root)

        top = QFrame()
        top.setObjectName("topbar")
        top_layout = QHBoxLayout(top)
        top_layout.setContentsMargins(18, 12, 18, 12)
        title_box = QVBoxLayout()
        title = QLabel("小组报数日记")
        title.setObjectName("title")
        self.cloud_label = QLabel("")
        self.cloud_label.setObjectName("muted")
        title_box.addWidget(title)
        title_box.addWidget(self.cloud_label)
        top_layout.addLayout(title_box)
        top_layout.addStretch(1)

        self.compact_check = QCheckBox("小巧模式")
        self.compact_check.toggled.connect(self._toggle_compact)
        self.choose_cloud_btn = QPushButton("选择云端数据文件")
        self.choose_cloud_btn.clicked.connect(self._choose_data_file)
        self.save_btn = QPushButton("保存并审核")
        self.save_btn.setObjectName("primary")
        self.save_btn.clicked.connect(self._save_current_record)
        top_layout.addWidget(self.compact_check)
        top_layout.addWidget(self.choose_cloud_btn)
        top_layout.addWidget(self.save_btn)
        outer.addWidget(top)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        outer.addWidget(splitter, stretch=1)

        self.sidebar = QFrame()
        self.sidebar.setObjectName("sidebar")
        side_layout = QVBoxLayout(self.sidebar)
        side_layout.setContentsMargins(14, 14, 14, 14)
        side_layout.setSpacing(10)
        side_layout.addWidget(QLabel("成员"))
        self.member_list = QListWidget()
        self.member_list.currentTextChanged.connect(self._member_changed)
        side_layout.addWidget(self.member_list, stretch=1)
        add_row = QHBoxLayout()
        self.member_input = QLineEdit()
        self.member_input.setPlaceholderText("新增成员")
        add_btn = QPushButton("+")
        add_btn.setToolTip("添加成员")
        add_btn.clicked.connect(self._add_member)
        add_row.addWidget(self.member_input)
        add_row.addWidget(add_btn)
        side_layout.addLayout(add_row)
        self.remove_member_btn = QPushButton("删除成员")
        self.remove_member_btn.clicked.connect(self._remove_member)
        side_layout.addWidget(self.remove_member_btn)
        splitter.addWidget(self.sidebar)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content = QWidget()
        self.main_layout = QVBoxLayout(content)
        self.main_layout.setContentsMargins(18, 18, 18, 18)
        self.main_layout.setSpacing(14)
        scroll.setWidget(content)
        splitter.addWidget(scroll)
        splitter.setSizes([250, 930])

        self._build_summary()
        self._build_entry_editor()
        self._build_rules()
        self._build_diary()
        self._build_history()

    def _build_summary(self):
        panel = QFrame()
        panel.setObjectName("panel")
        layout = QGridLayout(panel)
        layout.setContentsMargins(18, 16, 18, 16)
        layout.setHorizontalSpacing(18)
        layout.setVerticalSpacing(10)

        self.date_edit = QDateEdit()
        self.date_edit.setCalendarPopup(True)
        self.date_edit.setDisplayFormat("yyyy-MM-dd")
        self.date_edit.setDate(date.today())
        self.date_edit.dateChanged.connect(self._date_changed)
        self.quota_input = QLineEdit(str(self.data.get("quota", 3)))
        self.quota_input.editingFinished.connect(self._quota_changed)
        self.raw_total_label = QLabel("0")
        self.weighted_total_label = QLabel("0")
        self.audit_label = QLabel("未审核")
        self.audit_label.setObjectName("audit")

        layout.addWidget(QLabel("日期"), 0, 0)
        layout.addWidget(self.date_edit, 0, 1)
        layout.addWidget(QLabel("定额"), 0, 2)
        layout.addWidget(self.quota_input, 0, 3)
        layout.addWidget(QLabel("原始总数"), 1, 0)
        layout.addWidget(self.raw_total_label, 1, 1)
        layout.addWidget(QLabel("换算总数"), 1, 2)
        layout.addWidget(self.weighted_total_label, 1, 3)
        layout.addWidget(QLabel("审核"), 1, 4)
        layout.addWidget(self.audit_label, 1, 5)
        self.main_layout.addWidget(panel)

    def _build_entry_editor(self):
        panel = QFrame()
        panel.setObjectName("panel")
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(18, 16, 18, 16)
        header = QLabel("今日报数")
        header.setObjectName("sectionTitle")
        self.entry_text = QTextEdit()
        self.entry_text.setPlaceholderText("例如：\n视频：1\n音频：1\n字幕：1\n图片：1")
        self.entry_text.textChanged.connect(self._update_preview)
        self.parsed_table = QTableWidget(0, 4)
        self.parsed_table.setHorizontalHeaderLabels(["项目", "数量", "换算", "计入"])
        self.parsed_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.parsed_table.verticalHeader().setVisible(False)
        self.parsed_table.setMinimumHeight(150)
        layout.addWidget(header)
        layout.addWidget(self.entry_text, stretch=1)
        layout.addWidget(self.parsed_table)
        self.main_layout.addWidget(panel)

    def _build_rules(self):
        panel = QFrame()
        panel.setObjectName("panel")
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(18, 16, 18, 16)
        row = QHBoxLayout()
        title = QLabel("换算规则")
        title.setObjectName("sectionTitle")
        add_rule = QPushButton("新增项目")
        add_rule.clicked.connect(self._add_rule_row)
        row.addWidget(title)
        row.addStretch(1)
        row.addWidget(add_rule)
        self.rules_table = QTableWidget(0, 2)
        self.rules_table.setHorizontalHeaderLabels(["项目", "换算系数"])
        self.rules_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.rules_table.verticalHeader().setVisible(False)
        self.rules_table.cellChanged.connect(self._rules_changed)
        layout.addLayout(row)
        layout.addWidget(self.rules_table)
        self.main_layout.addWidget(panel)

    def _build_diary(self):
        panel = QFrame()
        panel.setObjectName("panel")
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(18, 16, 18, 16)
        title = QLabel("审核栏与日记")
        title.setObjectName("sectionTitle")
        self.status_combo = QComboBox()
        self.status_combo.addItems(["自动判断", "达标", "不达标", "待审核"])
        self.reason_text = QTextEdit()
        self.reason_text.setPlaceholderText("不达标原因、补救计划、审核备注...")
        self.harvest_text = QTextEdit()
        self.harvest_text.setPlaceholderText("达标后的收获、心得、明天计划...")
        self.diary_text = QTextEdit()
        self.diary_text.setPlaceholderText("自由日记编辑区，可以写当天过程、问题、灵感和复盘。")
        grid = QGridLayout()
        grid.addWidget(QLabel("状态"), 0, 0)
        grid.addWidget(self.status_combo, 0, 1)
        grid.addWidget(QLabel("原因/备注"), 1, 0)
        grid.addWidget(self.reason_text, 1, 1)
        grid.addWidget(QLabel("收获"), 2, 0)
        grid.addWidget(self.harvest_text, 2, 1)
        grid.addWidget(QLabel("日记"), 3, 0)
        grid.addWidget(self.diary_text, 3, 1)
        layout.addWidget(title)
        layout.addLayout(grid)
        self.main_layout.addWidget(panel)

    def _build_history(self):
        panel = QFrame()
        panel.setObjectName("panel")
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(18, 16, 18, 16)
        title = QLabel("小组记录总览")
        title.setObjectName("sectionTitle")
        self.history_table = QTableWidget(0, 6)
        self.history_table.setHorizontalHeaderLabels(["日期", "成员", "原始", "换算", "状态", "备注"])
        self.history_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.history_table.verticalHeader().setVisible(False)
        layout.addWidget(title)
        layout.addWidget(self.history_table)
        self.main_layout.addWidget(panel)

    def _apply_style(self):
        self.setStyleSheet("""
            QWidget {
                background: #f6f7f2;
                color: #20251f;
                font-family: "Microsoft YaHei", "Segoe UI", Arial;
                font-size: 14px;
            }
            #topbar {
                background: #19201d;
                border-bottom: 1px solid #d8ded3;
            }
            #title {
                color: #f8fff3;
                font-size: 24px;
                font-weight: 900;
            }
            #muted {
                color: #b8c6b0;
                font-size: 12px;
            }
            #sidebar, #panel, QFrame#panel {
                background: #ffffff;
                border: 1px solid #dbe2d4;
                border-radius: 8px;
            }
            #sidebar {
                border-left: none;
                border-top: none;
                border-bottom: none;
                border-radius: 0;
            }
            QLabel#sectionTitle {
                font-size: 17px;
                font-weight: 900;
            }
            QLabel#audit {
                border-radius: 6px;
                padding: 8px 12px;
                background: #edf1e8;
                font-weight: 900;
            }
            QLineEdit, QTextEdit, QComboBox, QDateEdit {
                background: #fbfcf8;
                border: 1px solid #cad4c4;
                border-radius: 6px;
                padding: 7px;
                selection-background-color: #2f6f59;
                selection-color: white;
            }
            QLineEdit:focus, QTextEdit:focus, QComboBox:focus, QDateEdit:focus {
                border-color: #2f6f59;
            }
            QPushButton {
                background: #eef3eb;
                border: 1px solid #c8d2c2;
                border-radius: 6px;
                padding: 8px 12px;
                font-weight: 800;
            }
            QPushButton:hover {
                background: #e1eadc;
                border-color: #2f6f59;
            }
            QPushButton#primary {
                background: #2f6f59;
                color: white;
                border-color: #2f6f59;
            }
            QTableWidget, QListWidget {
                background: #fbfcf8;
                alternate-background-color: #f0f4ec;
                border: 1px solid #d6dfd0;
                border-radius: 6px;
                gridline-color: #dfe7d9;
            }
            QHeaderView::section {
                background: #e9efe3;
                border: none;
                border-right: 1px solid #d4dece;
                padding: 8px;
                font-weight: 900;
            }
        """)

    def _refresh_everything(self):
        self.loading = True
        self.cloud_label.setText(f"数据文件：{self.data_file}")
        self.member_list.clear()
        for name in self.data.get("members", []):
            self.member_list.addItem(QListWidgetItem(name))
        matches = self.member_list.findItems(self.current_member, Qt.MatchFlag.MatchExactly)
        if matches:
            self.member_list.setCurrentItem(matches[0])
        elif self.member_list.count():
            self.member_list.setCurrentRow(0)
            self.current_member = self.member_list.currentItem().text()
        self.quota_input.setText(str(self.data.get("quota", 3)))
        self._refresh_rules_table()
        self._load_record_to_form()
        self._refresh_history()
        self.loading = False
        self._update_preview()

    def _refresh_rules_table(self):
        self.rules_table.blockSignals(True)
        self.rules_table.setRowCount(0)
        for item, weight in self.data.get("rules", {}).items():
            row = self.rules_table.rowCount()
            self.rules_table.insertRow(row)
            self.rules_table.setItem(row, 0, QTableWidgetItem(item))
            self.rules_table.setItem(row, 1, QTableWidgetItem(str(weight)))
        self.rules_table.blockSignals(False)

    def _record_key(self):
        return f"{self.current_date}|{self.current_member}"

    def _current_record(self):
        return self.data.setdefault("records", {}).setdefault(self._record_key(), {
            "date": self.current_date,
            "member": self.current_member,
            "text": "",
            "raw_total": 0,
            "weighted_total": 0,
            "status": "待审核",
            "reason": "",
            "harvest": "",
            "diary": "",
            "items": {},
            "updated_at": "",
        })

    def _load_record_to_form(self):
        record = self._current_record()
        self.entry_text.blockSignals(True)
        self.reason_text.blockSignals(True)
        self.harvest_text.blockSignals(True)
        self.diary_text.blockSignals(True)
        self.status_combo.blockSignals(True)
        self.entry_text.setPlainText(record.get("text", ""))
        self.reason_text.setPlainText(record.get("reason", ""))
        self.harvest_text.setPlainText(record.get("harvest", ""))
        self.diary_text.setPlainText(record.get("diary", ""))
        status = record.get("status", "自动判断")
        self.status_combo.setCurrentText(status if status in ["自动判断", "达标", "不达标", "待审核"] else "自动判断")
        self.entry_text.blockSignals(False)
        self.reason_text.blockSignals(False)
        self.harvest_text.blockSignals(False)
        self.diary_text.blockSignals(False)
        self.status_combo.blockSignals(False)

    def _parse_entry(self, text):
        counts = {}
        pattern = re.compile(r"^\s*([^:：\n]+)\s*[:：]\s*(-?\d+(?:\.\d+)?)\s*$")
        for line in text.splitlines():
            match = pattern.match(line)
            if not match:
                continue
            name = match.group(1).strip()
            counts[name] = counts.get(name, 0.0) + safe_float(match.group(2))
        raw_total = sum(counts.values())
        weighted_total = sum(amount * safe_float(self.data.get("rules", {}).get(name, 1.0), 1.0) for name, amount in counts.items())
        return counts, raw_total, weighted_total

    def _update_preview(self):
        counts, raw_total, weighted_total = self._parse_entry(self.entry_text.toPlainText())
        self.raw_total_label.setText(f"{raw_total:g}")
        self.weighted_total_label.setText(f"{weighted_total:g}")
        quota = safe_float(self.quota_input.text(), 3.0)
        passed = weighted_total >= quota
        self.audit_label.setText("达标  ✓" if passed else "不达标")
        self.audit_label.setStyleSheet(
            "background:#dff3df;color:#1d6b33;" if passed else "background:#ffe7df;color:#a33b22;"
        )
        self.parsed_table.setRowCount(0)
        for name, amount in counts.items():
            weight = safe_float(self.data.get("rules", {}).get(name, 1.0), 1.0)
            row = self.parsed_table.rowCount()
            self.parsed_table.insertRow(row)
            for col, value in enumerate([name, f"{amount:g}", f"{weight:g}", f"{amount * weight:g}"]):
                self.parsed_table.setItem(row, col, QTableWidgetItem(value))

    def _save_current_record(self):
        self._quota_changed(save=False)
        counts, raw_total, weighted_total = self._parse_entry(self.entry_text.toPlainText())
        quota = safe_float(self.data.get("quota", 3.0), 3.0)
        auto_status = "达标" if weighted_total >= quota else "不达标"
        selected = self.status_combo.currentText()
        status = auto_status if selected == "自动判断" else selected
        record = self._current_record()
        record.update({
            "date": self.current_date,
            "member": self.current_member,
            "text": self.entry_text.toPlainText(),
            "raw_total": raw_total,
            "weighted_total": weighted_total,
            "status": status,
            "reason": self.reason_text.toPlainText().strip(),
            "harvest": self.harvest_text.toPlainText().strip(),
            "diary": self.diary_text.toPlainText().strip(),
            "items": counts,
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        })
        save_json(self.data_file, self.data)
        self.last_mtime = self._mtime()
        self._refresh_history()
        self._update_preview()
        if auto_status == "不达标" and not record["reason"]:
            dialog = TextDialog("今天未达标", "很遗憾，今天还没达到定额。写一下原因或补救计划吧。", self)
            if dialog.exec() == QDialog.DialogCode.Accepted:
                record["reason"] = dialog.value()
                self.reason_text.setPlainText(record["reason"])
                save_json(self.data_file, self.data)
                self.last_mtime = self._mtime()
        elif auto_status == "达标" and not record["harvest"]:
            dialog = TextDialog("达标啦 ✓", "今天达标或超额了，继续努力！可以写一点收获。", self)
            if dialog.exec() == QDialog.DialogCode.Accepted:
                record["harvest"] = dialog.value()
                self.harvest_text.setPlainText(record["harvest"])
                save_json(self.data_file, self.data)
                self.last_mtime = self._mtime()
        else:
            QMessageBox.information(self, "已保存", "数据已经保存并更新总览。")

    def _refresh_history(self):
        rows = sorted(self.data.get("records", {}).values(), key=lambda r: (r.get("date", ""), r.get("member", "")), reverse=True)
        self.history_table.setRowCount(0)
        for record in rows:
            row = self.history_table.rowCount()
            self.history_table.insertRow(row)
            values = [
                record.get("date", ""),
                record.get("member", ""),
                f"{safe_float(record.get('raw_total')):g}",
                f"{safe_float(record.get('weighted_total')):g}",
                record.get("status", ""),
                record.get("reason") or record.get("harvest") or "",
            ]
            for col, value in enumerate(values):
                self.history_table.setItem(row, col, QTableWidgetItem(str(value)))

    def _rules_changed(self):
        if self.loading:
            return
        rules = {}
        for row in range(self.rules_table.rowCount()):
            name_item = self.rules_table.item(row, 0)
            weight_item = self.rules_table.item(row, 1)
            name = name_item.text().strip() if name_item else ""
            if name:
                rules[name] = safe_float(weight_item.text() if weight_item else 1, 1.0)
        self.data["rules"] = rules
        save_json(self.data_file, self.data)
        self.last_mtime = self._mtime()
        self._update_preview()

    def _add_rule_row(self):
        row = self.rules_table.rowCount()
        self.rules_table.insertRow(row)
        self.rules_table.setItem(row, 0, QTableWidgetItem("新项目"))
        self.rules_table.setItem(row, 1, QTableWidgetItem("1"))

    def _quota_changed(self, save=True):
        self.data["quota"] = safe_float(self.quota_input.text(), 3.0)
        if save:
            save_json(self.data_file, self.data)
            self.last_mtime = self._mtime()
            self._update_preview()

    def _add_member(self):
        name = self.member_input.text().strip()
        if not name or name in self.data["members"]:
            return
        self.data["members"].append(name)
        self.current_member = name
        self.member_input.clear()
        save_json(self.data_file, self.data)
        self.last_mtime = self._mtime()
        self._refresh_everything()

    def _remove_member(self):
        if len(self.data["members"]) <= 1:
            QMessageBox.warning(self, "不能删除", "至少保留一个成员。")
            return
        name = self.current_member
        if QMessageBox.question(self, "删除成员", f"确定删除成员“{name}”？历史记录会保留。") != QMessageBox.StandardButton.Yes:
            return
        self.data["members"] = [m for m in self.data["members"] if m != name]
        self.current_member = self.data["members"][0]
        save_json(self.data_file, self.data)
        self.last_mtime = self._mtime()
        self._refresh_everything()

    def _member_changed(self, name):
        if self.loading or not name:
            return
        self.current_member = name
        self.loading = True
        self._load_record_to_form()
        self.loading = False
        self._update_preview()

    def _date_changed(self, qdate):
        if self.loading:
            return
        self.current_date = qdate.toString("yyyy-MM-dd")
        self.loading = True
        self._load_record_to_form()
        self.loading = False
        self._update_preview()

    def _choose_data_file(self):
        path, _ = QFileDialog.getSaveFileName(
            self,
            "选择共享数据文件",
            str(self.data_file),
            "JSON 数据文件 (*.json)",
        )
        if not path:
            return
        self.data_file = Path(path)
        if self.data_file.exists():
            self.data = load_json(self.data_file, DEFAULT_DATA)
        else:
            save_json(self.data_file, self.data)
        self.settings["data_file"] = str(self.data_file)
        save_settings(self.settings)
        self.last_mtime = self._mtime()
        self._refresh_everything()

    def _maybe_reload_external_changes(self):
        current = self._mtime()
        if current and current != self.last_mtime:
            self.data = load_json(self.data_file, DEFAULT_DATA)
            self.last_mtime = current
            self._refresh_everything()

    def _toggle_compact(self, enabled):
        self.sidebar.setVisible(not enabled)
        self.resize(760, 680) if enabled else self.resize(1180, 780)


def main():
    app = QApplication(sys.argv)
    app.setFont(QFont("Microsoft YaHei", 10))
    window = DailyReportApp()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
