import type {

  IChartApi,

  IPrimitivePaneRenderer,

  IPrimitivePaneView,

  ISeriesApi,

  ISeriesPrimitive,

  SeriesAttachedParameter,

  Time,

} from "lightweight-charts";



export type TradeTriangleMarker = {

  date: string;

  type: "BUY" | "SELL";

  price: number;

};



type MarkerColors = { buy: string; sell: string };



class TriangleRenderer implements IPrimitivePaneRenderer {

  constructor(

    private markers: TradeTriangleMarker[],

    private chart: IChartApi,

    private series: ISeriesApi<"Candlestick">,

    private colors: MarkerColors,

  ) {}



  draw(

    target: Parameters<IPrimitivePaneRenderer["draw"]>[0],

  ): void {

    target.useBitmapCoordinateSpace(

      ({ context, horizontalPixelRatio, verticalPixelRatio }) => {

        const half = 5 * horizontalPixelRatio;

        const height = 7 * verticalPixelRatio;

        const gap = 10 * verticalPixelRatio;

        const timeScale = this.chart.timeScale();



        for (const m of this.markers) {

          if (m.type !== "BUY" && m.type !== "SELL") continue;

          const x = timeScale.timeToCoordinate(m.date as Time);

          const y = this.series.priceToCoordinate(m.price);

          if (x === null || y === null) continue;



          const px = Math.round(x * horizontalPixelRatio);

          const baseY = y * verticalPixelRatio;

          const py =

            m.type === "BUY" ? baseY + gap : baseY - gap;

          const color = m.type === "BUY" ? this.colors.buy : this.colors.sell;



          context.fillStyle = color;

          context.beginPath();

          if (m.type === "BUY") {

            context.moveTo(px, py);

            context.lineTo(px - half, py + height);

            context.lineTo(px + half, py + height);

          } else {

            context.moveTo(px, py);

            context.lineTo(px - half, py - height);

            context.lineTo(px + half, py - height);

          }

          context.closePath();

          context.fill();

        }

      },

    );

  }

}



class TrianglePaneView implements IPrimitivePaneView {

  private markers: TradeTriangleMarker[];

  private chart: IChartApi | null = null;

  private series: ISeriesApi<"Candlestick"> | null = null;

  private colors: MarkerColors;



  constructor(markers: TradeTriangleMarker[], colors: MarkerColors) {

    this.markers = markers;

    this.colors = colors;

  }



  setContext(chart: IChartApi, series: ISeriesApi<"Candlestick">) {

    this.chart = chart;

    this.series = series;

  }



  update(markers: TradeTriangleMarker[], colors: MarkerColors) {

    this.markers = markers;

    this.colors = colors;

  }



  zOrder(): "top" {

    return "top";

  }



  renderer(): IPrimitivePaneRenderer | null {

    if (!this.chart || !this.series) return null;

    return new TriangleRenderer(

      this.markers,

      this.chart,

      this.series,

      this.colors,

    );

  }

}



export class TradeTriangleMarkersPrimitive implements ISeriesPrimitive<Time> {

  private paneView: TrianglePaneView;

  private requestUpdate?: () => void;



  constructor(markers: TradeTriangleMarker[], colors: MarkerColors) {

    this.paneView = new TrianglePaneView(markers, colors);

  }



  attached(param: SeriesAttachedParameter<Time>): void {

    this.paneView.setContext(

      param.chart,

      param.series as ISeriesApi<"Candlestick">,

    );

    this.requestUpdate = param.requestUpdate;

  }



  detached(): void {

    this.requestUpdate = undefined;

  }



  paneViews(): readonly IPrimitivePaneView[] {

    return [this.paneView];

  }



  updateAllViews(): void {

    this.requestUpdate?.();

  }



  setMarkers(markers: TradeTriangleMarker[], colors: MarkerColors) {

    this.paneView.update(markers, colors);

    this.updateAllViews();

  }

}

