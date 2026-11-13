// Demonstration data only. None of these are verified supplier offers.
// Supplier names illustrate possible sourcing channels, not actual availability.
const groups = {
  living: [
    ["적층형 투명 수납함 대형", 3800, "organizer", "수납 정리 리빙박스 옷장"],
    ["접이식 패브릭 리빙박스 40L", 5200, "bag", "수납 정리 이불 옷장"],
    ["실리콘 창문 틈새 문풍지 5M", 1900, "tape", "방한 겨울 외풍차단 단열"],
    ["무타공 욕실 코너 선반", 4600, "rack", "욕실 정리 수납 선반"],
    ["롱 핸들 틈새 청소 브러시", 1400, "brush", "청소 욕실 솔"],
    ["여행용 압축 수납 파우치 세트", 6700, "bag", "여행 정리 수납 파우치"],
  ],
  kitchen: [
    ["실리콘 조리도구 4종 세트", 5900, "kitchen", "주방 조리 뒤집개 국자"],
    ["서랍 칸막이 커트러리 정리함", 3200, "organizer", "주방 정리 수납 수저"],
    ["스테인리스 수세미 건조 받침대", 2800, "rack", "주방 싱크대 정리 수납"],
    ["다용도 밀봉 집게 12개입", 1200, "clip", "주방 보관 봉투 클립"],
    ["접이식 실리콘 드라잉 매트", 4100, "mat", "주방 식기 건조 설거지"],
    ["캠핑 스테인리스 머그컵 350ml", 3600, "bottle", "주방 캠핑 컵 머그"],
  ],
  pet: [
    [
      "반려동물 더블 식기 받침 세트",
      6800,
      "petbowl",
      "반려동물 강아지 고양이 급식 식기",
    ],
    ["강아지 산책 배변봉투 파우치", 1800, "bag", "반려동물 강아지 산책 배변"],
    ["고양이 펠트 터널 하우스", 8900, "petbowl", "반려동물 고양이 놀이 숨숨집"],
    ["반려동물 털 정리 브러시", 3300, "brush", "반려동물 강아지 고양이 빗"],
    ["반려동물 논슬립 식기 매트", 2400, "mat", "반려동물 강아지 고양이 식기"],
    [
      "반려견 산책용 접이식 물그릇",
      2100,
      "petbowl",
      "반려동물 강아지 캠핑 산책",
    ],
  ],
  outdoor: [
    ["캠핑 멀티 수납 오거나이저", 7900, "bag", "캠핑 소품 정리 수납 여행"],
    ["접이식 캠핑 미니 테이블", 14900, "rack", "캠핑 레저 피크닉 테이블"],
    ["캠핑용 텐트 고정 스트랩 4개", 2900, "clip", "캠핑 소품 텐트 타프"],
    ["피크닉 방수 돗자리 150×200", 6500, "mat", "캠핑 피크닉 소풍 매트"],
    ["캠핑용 보냉 토트백 15L", 8400, "bag", "캠핑 소품 도시락 보냉"],
    ["캠핑 다용도 카라비너 6개입", 2200, "clip", "캠핑 소품 고리 정리"],
  ],
  car: [
    ["차량용 시트 틈새 수납 포켓", 4600, "car", "차량 자동차 정리 수납"],
    ["차량용 접이식 트렁크 정리함", 7600, "organizer", "차량 자동차 수납 정리"],
    ["극세사 차량 세차 타월 3매", 3200, "mat", "차량 자동차 청소 세차"],
    ["차량 뒷좌석 멀티 수납함", 6900, "car", "차량 자동차 수납 정리"],
    ["차량용 송풍구 틈새 청소 솔", 1500, "brush", "차량 자동차 청소 브러시"],
    [
      "겨울 차량용 성에 제거 스크래퍼",
      2500,
      "brush",
      "차량 자동차 방한 겨울 제설",
    ],
  ],
  office: [
    [
      "데스크 펜 트레이 오거나이저",
      3900,
      "stationery",
      "문구 사무 책상 정리 수납",
    ],
    ["A5 도트 노트 3권 세트", 2900, "stationery", "문구 사무 다이어리 필기"],
    ["실리콘 케이블 정리 홀더 6개", 1600, "clip", "문구 사무 책상 정리 케이블"],
    ["접이식 책상 미니 선반", 5800, "rack", "문구 사무 데스크 수납 정리"],
    ["컬러 인덱스 북마크 8색", 1100, "stationery", "문구 사무 독서 책갈피"],
    ["A4 서류 보관 파일 박스", 3400, "organizer", "문구 사무 서류 정리 수납"],
  ],
  fashion: [
    ["캔버스 데일리 미니 에코백", 4500, "bag", "패션 잡화 가방 토트백"],
    ["여행용 세면도구 파우치", 3800, "bag", "패션 잡화 여행 수납 정리"],
    ["니트 손목 워머 한 쌍", 2600, "glove", "패션 잡화 방한 겨울 손목"],
    ["패브릭 헤어 스크런치 3개", 1900, "clip", "패션 잡화 헤어 머리끈"],
    ["다용도 패브릭 지퍼 파우치", 2300, "bag", "패션 잡화 수납 여행"],
    ["미니 액세서리 보관 케이스", 3100, "organizer", "패션 잡화 액세서리 정리"],
  ],
  garden: [
    ["미니 원예 도구 3종 세트", 4200, "garden", "원예 화분 텃밭 도구"],
    ["모종 분갈이 작업 매트", 3500, "mat", "원예 화분 가드닝 분갈이"],
    ["원예용 식물 이름표 20개", 1300, "stationery", "원예 가드닝 식물 텃밭"],
    ["다용도 공구 수납 파우치", 5900, "bag", "공구 정리 수납 작업"],
    [
      "분무 조절 원예 스프레이 500ml",
      2200,
      "bottle",
      "원예 가드닝 화분 분무기",
    ],
    ["가드닝 코팅 작업 장갑", 1800, "glove", "원예 가드닝 공구 장갑"],
  ],
};

const supplierIds = [
  "domeggook",
  "domeme",
  "ownerclan",
  "onchannel",
  "dometopia",
];
const moqs = [1, 1, 5, 1, 10, 2];
const groupedProducts = Object.entries(groups).map(
  ([categoryId, products], groupIndex) =>
    products.map(([name, wholesalePrice, art, keywords], index) => {
      const sourceId = supplierIds[(index + groupIndex) % supplierIds.length];
      return {
        id: `demo-${categoryId}-${index + 1}`,
        name,
        sourceId,
        categoryId,
        wholesalePrice,
        art,
        shippingFee: (index + groupIndex) % 5 === 0 ? 0 : 3000,
        minOrder: ["domeme", "ownerclan", "onchannel"].includes(sourceId)
          ? 1
          : moqs[index],
        fulfillment: ["domeme", "ownerclan", "onchannel"].includes(sourceId)
          ? "consignment"
          : "wholesale",
        tags: keywords.split(" "),
        description:
          "기능 체험용 예시 상품입니다. 표시된 소싱처의 실제 취급 상품·공급가·재고를 확인한 정보가 아닙니다.",
        sku: "",
        url: "",
        imageUrl: "",
        dataKind: "demo",
      };
    }),
);

// Interleave categories so the initial gallery shows a broad product mix.
export const DEMO_PRODUCTS = Array.from(
  { length: Math.max(...groupedProducts.map((products) => products.length)) },
  (_, index) =>
    groupedProducts.map((products) => products[index]).filter(Boolean),
).flat();
