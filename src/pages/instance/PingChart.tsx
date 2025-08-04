import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, SegmentedControl, Card, Switch, Button } from "@radix-ui/themes";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import Loading from "@/components/loading";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
} from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import fillMissingTimePoints, {
  cutPeakValues,
  calculateLossRate,
} from "@/utils/RecordHelper";
import Tips from "@/components/ui/tips";
import { Eye, EyeOff } from "lucide-react";
import "@/components/MobileChart.css";
import "@/components/DesktopChart.css";

interface PingRecord {
  client: string;
  task_id: number;
  time: string;
  value: number;
}
interface TaskInfo {
  id: number;
  name: string;
  interval: number;
}
interface PingApiResp {
  status: string;
  message: string;
  data: {
    count: number;
    records: PingRecord[];
    tasks: TaskInfo[];
  };
}

//const MAX_POINTS = 1000;
const colors = [
  "#F38181",
  "#347433",
  "#898AC4",
  "#03A6A1",
  "#7AD6F0",
  "#B388FF",
  "#FF8A65",
  "#FFD600",
];

const PingChart = ({ uuid }: { uuid: string }) => {
  const { t } = useTranslation();
  const { publicInfo } = usePublicInfo();
  const max_record_preserve_time = publicInfo?.ping_record_preserve_time || 0;
  // 视图选项
  const presetViews = [
    { label: t("chart.hours", { count: 1 }), hours: 1 },
    { label: t("chart.hours", { count: 6 }), hours: 6 },
    { label: t("chart.hours", { count: 12 }), hours: 12 },
    { label: t("chart.days", { count: 1 }), hours: 24 },
  ];
  const avaliableView: { label: string; hours?: number }[] = [];
  if (
    typeof max_record_preserve_time === "number" &&
    max_record_preserve_time > 0
  ) {
    for (const v of presetViews) {
      if (max_record_preserve_time >= v.hours) {
        avaliableView.push({ label: v.label, hours: v.hours });
      }
    }
    const maxPreset = presetViews[presetViews.length - 1];
    if (max_record_preserve_time > maxPreset.hours) {
      avaliableView.push({
        label: `${t("chart.hours", { count: max_record_preserve_time })}`,
        hours: max_record_preserve_time,
      });
    } else if (
      max_record_preserve_time > 1 &&
      !presetViews.some((v) => v.hours === max_record_preserve_time)
    ) {
      avaliableView.push({
        label: `${t("chart.hours", { count: max_record_preserve_time })}`,
        hours: max_record_preserve_time,
      });
    }
  }

  // 默认视图设为1小时
  const initialView =
    avaliableView.find((v) => v.hours === 1)?.label ||
    avaliableView[0]?.label ||
    "";
  const [view, setView] = useState<string>(initialView);
  const [hours, setHours] = useState<number>(
    avaliableView.find((v) => v.label === initialView)?.hours || 1
  ); // Add hours state

  const [remoteData, setRemoteData] = useState<PingRecord[] | null>(null);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cutPeak, setCutPeak] = useState(false); // 平滑开关，默认关闭

  // Update hours state when view changes
  useEffect(() => {
    const selected = avaliableView.find((v) => v.label === view);
    if (selected && selected.hours !== undefined) {
      setHours(selected.hours);
    }
  }, [view, avaliableView]);

  // 拉取历史数据
  useEffect(() => {
    if (!uuid) return;
    if (!hours) {
      // Use hours directly
      setRemoteData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/records/ping?uuid=${uuid}&hours=${hours}`) // Use hours directly
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((resp: PingApiResp) => {
        const records = resp.data?.records || [];
        records.sort(
          (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
        );
        setRemoteData(records);
        setTasks(resp.data?.tasks || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Error");
        setLoading(false);
      });
  }, [hours, uuid]); // Depend on hours

  const midData = useMemo(() => {
    const data = remoteData || [];
    if (!data.length) return [];

    const grouped: Record<string, any> = {};
    const timeKeys: number[] = [];

    //for (const rec of sliced) {
    for (const rec of data) {
      const t = new Date(rec.time).getTime();
      let foundKey = null;
      for (const key of timeKeys) {
        if (Math.abs(key - t) <= 1500) {
          foundKey = key;
          break;
        }
      }
      const useKey = foundKey !== null ? foundKey : t;
      if (!grouped[useKey]) {
        grouped[useKey] = { time: new Date(useKey).toISOString() };
        if (foundKey === null) timeKeys.push(useKey);
      }
      grouped[useKey][rec.task_id] = rec.value;
    }

    let full = Object.values(grouped).sort(
      (a: any, b: any) =>
        new Date(a.time).getTime() - new Date(b.time).getTime()
    );
    const full1 = fillMissingTimePoints(
      full,
      tasks[0]?.interval || 60,
      hours * 60 * 60,
      tasks[0]?.interval ? tasks[0]?.interval * 1.2 : 60 * 1.2
    );
    return full1;
  }, [remoteData, cutPeak, tasks, hours]);

  // 组装图表数据
  const chartData = useMemo(() => {
    let full = midData;
    // 如果开启削峰，应用削峰处理
    if (cutPeak && tasks.length > 0) {
      const taskKeys = tasks.map((task) => String(task.id));
      full = cutPeakValues(midData, taskKeys);
    }
    return full;
  }, [remoteData, cutPeak, tasks, hours]);

  // 时间格式化
  const timeFormatter = (value: any, index: number) => {
    if (!chartData.length) return "";
    if (index === 0 || index === chartData.length - 1) {
      if (hours < 24) {
        // Use hours for conditional formatting
        return new Date(value).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      return new Date(value).toLocaleDateString([], {
        month: "2-digit",
        day: "2-digit",
      });
    }
    return "";
  };
  const lableFormatter = (value: any) => {
    const date = new Date(value);
    if (hours < 24) {
      // Use hours for conditional formatting
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
    return date.toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // 颜色配置
  const chartConfig = useMemo(() => {
    const config: Record<string, any> = {};
    tasks.forEach((task, idx) => {
      config[task.id] = {
        label: task.name,
        color: colors[idx % colors.length],
      };
    });
    return config;
  }, [tasks]);

  const latestValues = useMemo(() => {
    if (!remoteData || !tasks.length) return [];
    const map = new Map<number, PingRecord>();
    for (let i = remoteData.length - 1; i >= 0; i--) {
      const rec = remoteData[i];
      if (!map.has(rec.task_id)) {
        map.set(rec.task_id, rec);
      }
    }
    return tasks.map((task, idx) => ({
      ...task,
      value: map.get(task.id)?.value ?? null,
      time: map.get(task.id)?.time ?? null,
      color: colors[idx % colors.length],
    }));
  }, [remoteData, tasks]);

  const [hiddenLines, setHiddenLines] = useState<Record<string, boolean>>({});
  const handleLegendClick = useCallback((e: any) => {
    const key = e.dataKey;
    setHiddenLines((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleAllLines = useCallback(() => {
    const allHidden = tasks.every((task) => hiddenLines[String(task.id)]);
    const newHiddenState: Record<string, boolean> = {};
    tasks.forEach((task) => {
      newHiddenState[String(task.id)] = !allHidden;
    });
    setHiddenLines(newHiddenState);
  }, [tasks, hiddenLines]);

  return (
    <Flex direction="column" align="center" gap="3" className="w-full">
      <div className="w-full px-3 md:px-0 mb-2 overflow-x-auto timeline-scroll">
        <Flex justify="center" className="w-full min-w-fit">
          <SegmentedControl.Root
            radius="full"
            value={view}
            onValueChange={(newView) => {
              setView(newView);
              const selected = avaliableView.find((v) => v.label === newView);
              if (selected && selected.hours !== undefined) {
                setHours(selected.hours);
              }
            }}
            className="w-full max-w-[600px] min-w-fit"
            style={{
              minWidth: 'max-content'
            }}
          >
            {avaliableView.map((v) => (
              <SegmentedControl.Item
                key={v.label}
                value={v.label}
                className="flex-1 capitalize whitespace-nowrap"
                style={{
                  minWidth: '80px'
                }}
              >
                {v.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </Flex>
      </div>

      {loading && (
        <div style={{ textAlign: "center", width: "100%" }}>
          <Loading />
        </div>
      )}
      {error && (
        <div style={{ color: "red", textAlign: "center", width: "100%" }}>
          {error}
        </div>
      )}
      {latestValues.length > 0 ? (
        <Card className="w-full mb-3" style={{
          borderRadius: "12px",
          padding: "1rem",
          background: "var(--color-panel-solid)",
          border: "1px solid var(--gray-a4)"
        }}>
          <Tips className="absolute top-0 right-0 m-2">
            <label>
              {t("chart.loss_tips")}
            </label>
          </Tips>
          <div
            className="grid gap-2 mb-1 w-full"
            style={{
              gridTemplateColumns: `repeat(auto-fit, minmax(200px,1fr))`,
            }}
          >
            {latestValues.map((task) => (
              <div 
                key={task.id} 
                className="flex flex-row items-center rounded-lg p-2 cursor-pointer hover:shadow-md transition-all" 
                style={{
                  background: hiddenLines[String(task.id)] ? "var(--gray-a1)" : "var(--gray-a2)",
                  border: `1px solid ${hiddenLines[String(task.id)] ? "var(--gray-a3)" : "var(--gray-a4)"}`,
                  transition: "all 0.2s ease",
                  opacity: hiddenLines[String(task.id)] ? 0.6 : 1
                }}
                onClick={() => handleLegendClick({ dataKey: String(task.id) })}
                title={hiddenLines[String(task.id)] ? t("chart.clickToShow") : t("chart.clickToHide")}
              >
                <div
                  className="w-1.5 h-6 rounded-sm mr-2"
                  style={{ 
                    backgroundColor: task.color,
                    opacity: hiddenLines[String(task.id)] ? 0.5 : 1
                  }}
                />
                <div className="flex items-start justify-center flex-col flex-1">
                  <label className="font-semibold text-sm cursor-pointer" style={{
                    textDecoration: hiddenLines[String(task.id)] ? "line-through" : "none"
                  }}>{task.name}</label>
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    <span style={{ fontWeight: 500 }}>
                      {task.value !== null ? `${task.value} ms` : "-"}
                    </span>
                    <span>
                      {chartData && chartData.length > 0
                        ? `${calculateLossRate(midData, task.id)}% ${t("chart.lossRate")}`
                        : "-"}
                    </span>
                  </div>
                </div>
                {hiddenLines[String(task.id)] && (
                  <EyeOff size={12} className="text-muted-foreground ml-1" />
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <div className="w-full text-center text-muted-foreground mb-2">
          暂无数据
        </div>
      )}
      <Card className="w-full" style={{
        borderRadius: "12px",
        padding: "1rem",
        background: "var(--color-panel-solid)",
        border: "1px solid var(--gray-a4)",
        minHeight: "250px"
      }}>
        {chartData.length === 0 ? (
          <div className="w-full h-40 flex items-center justify-center text-muted-foreground">
            暂无数据
          </div>
        ) : (
          <ChartContainer config={chartConfig}>
            <LineChart
              data={chartData}
              accessibilityLayer
              margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="2 4" stroke="var(--gray-a3)" />
              <XAxis
                dataKey="time"
                tickLine={false}
                tickFormatter={timeFormatter}
                interval={0}
                tick={{ fontSize: 11 }}
                axisLine={false}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                unit="ms"
                allowDecimals={false}
                orientation="left"
                type="number"
                tick={{ dx: -10, fontSize: 11 }}
                mirror={true}
                width={45}
              />
              <ChartTooltip
                cursor={false}
                formatter={(v: any) => `${Math.round(v)} ms`}
                content={
                  <ChartTooltipContent
                    labelFormatter={lableFormatter}
                    indicator="dot"
                  />
                }
              />
              <ChartLegend onClick={handleLegendClick} />
              {tasks.map((task, idx) => (
                <Line
                  key={task.id}
                  dataKey={String(task.id)}
                  name={task.name}
                  stroke={colors[idx % colors.length]}
                  dot={false}
                  isAnimationActive={false}
                  strokeWidth={2}
                  connectNulls={false}
                  type={cutPeak ? "basis" : "linear"}
                  hide={!!hiddenLines[String(task.id)]}
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}
        {/* Cut Peak 开关和显示/隐藏所有按钮 */}
        <div
          className="flex items-center justify-between gap-4 mt-2"
          style={{ display: loading ? "none" : "flex" }}
        >
          <div className="flex items-center gap-2">
            <Switch
              id="cut-peak"
              checked={cutPeak}
              onCheckedChange={setCutPeak}
              size="1"
            />
            <label htmlFor="cut-peak" className="text-xs font-medium flex items-center gap-1 flex-row">
              {t("chart.cutPeak")}
              <Tips><span dangerouslySetInnerHTML={{ __html: t("chart.cutPeak_tips") }} /></Tips>
            </label>
          </div>
          <Button
            variant="soft"
            size="1"
            onClick={toggleAllLines}
            className="flex items-center gap-1"
          >
            {tasks.every((task) => hiddenLines[String(task.id)]) ? (
              <>
                <Eye size={14} />
                {t("chart.showAll")}
              </>
            ) : (
              <>
                <EyeOff size={14} />
                {t("chart.hideAll")}
              </>
            )}
          </Button>
        </div>
      </Card>
    </Flex>
  );
};

export default PingChart;
