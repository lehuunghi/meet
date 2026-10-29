package main

import (
	"fmt"
	"github.com/xuri/excelize/v2"
	"net/http"
)

func exportAttendance(w http.ResponseWriter, r *http.Request, rows []map[string]any) {
	if len(rows) > 10000 {
		problem(w, 400, "Quá 10.000 dòng; chọn từng buổi để xuất")
		return
	}
	f := excelize.NewFile()
	defer f.Close()
	sheet := "Điểm danh"
	f.SetSheetName("Sheet1", sheet)
	cols := []struct{ key, title string }{{"class_name", "Lớp"}, {"course", "Môn học"}, {"meeting_title", "Buổi học"}, {"lesson_start", "Giờ vào chung (VN)"}, {"lesson_end", "Giờ ra chung (VN)"}, {"name", "Họ tên học sinh"}, {"email", "Email"}, {"joined_at", "Vào lớp (VN)"}, {"last_seen", "Ra lớp / ghi nhận cuối (VN)"}, {"seconds", "Giây kết nối"}, {"attendance_result", "Kết quả"}, {"term_name", "Năm học / học kỳ"}, {"legacy_history", "Lịch sử kế thừa (1=cần đối chiếu)"}}
	style, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Family: "Arial", Size: 11}})
	f.SetColStyle(sheet, "A:M", style)
	f.SetColWidth(sheet, "A", "M", 26)
	for i, c := range cols {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellStr(sheet, cell, c.title)
	}
	for n, row := range rows {
		for i, c := range cols {
			cell, _ := excelize.CoordinatesToCellName(i+1, n+2)
			v := ""
			if row[c.key] != nil {
				v = fmt.Sprint(row[c.key])
				if c.key == "lesson_start" || c.key == "lesson_end" || c.key == "joined_at" || c.key == "last_seen" {
					v = vietnamDateText(row[c.key], false)
				}
			}
			f.SetCellStr(sheet, cell, v)
		}
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", "attachment; filename=diem-danh.xlsx")
	if e := f.Write(w); e != nil {
		return
	}
}
