export const SOURCES = [
  {
    id: "domeggook",
    name: "도매꾹",
    mark: "꾹",
    tone: "orange",
    type: "종합 도매",
    country: "국내",
    home: "https://domeggook.com/",
    search: "https://domeggook.com/main/item/itemList.php?sw=",
    description:
      "대량 구매·묶음 소싱. 최소 주문 수량과 옵션별 가격을 확인하세요.",
  },
  {
    id: "domeme",
    name: "도매매",
    mark: "매",
    tone: "blue",
    type: "배송대행",
    country: "국내",
    home: "https://domeme.domeggook.com/",
    search:
      "https://domeme.domeggook.com/index/item/supplyList.php?mode=search&sw=",
    description: "배송대행 상품 탐색. 공급사별 위탁 판매 조건을 확인하세요.",
  },
  {
    id: "ownerclan",
    name: "오너클랜",
    mark: "O",
    tone: "red",
    type: "위탁·도매",
    country: "국내",
    home: "https://www.ownerclan.com/",
    search: "https://www.ownerclan.com/V2/product/search.php?keyword=",
    description:
      "종합 B2B 상품 소싱. 회원 공급가와 상세페이지 이용 조건을 확인하세요.",
  },
  {
    id: "onchannel",
    name: "온채널",
    mark: "on",
    tone: "green",
    type: "위탁·도매",
    country: "국내",
    home: "https://www.onch3.co.kr/",
    search: "https://www.onch3.co.kr/dbcenter_renewal/?keyword=",
    description:
      "위탁 상품과 공급사 탐색. 판매 승인·최종 판매가 정책을 확인하세요.",
  },
  {
    id: "dometopia",
    name: "도매토피아",
    mark: "D",
    tone: "purple",
    type: "생활 도매",
    country: "국내",
    home: "https://dometopia.com/",
    search: "https://dometopia.com/goods/search?search_text=",
    description:
      "생활 잡화·문구 소싱. 재고와 묶음 배송 가능 여부를 확인하세요.",
  },
  {
    id: "1688",
    name: "1688",
    mark: "1688",
    tone: "orange",
    type: "중국 도매",
    country: "해외",
    home: "https://www.1688.com/",
    search: "https://s.1688.com/selloffer/offer_search.htm?keywords=",
    description:
      "중국어 검색 권장. 환율·관부가세·국제운임·인증 비용을 별도로 확인하세요.",
  },
  {
    id: "alibaba",
    name: "Alibaba",
    mark: "a",
    tone: "amber",
    type: "글로벌 B2B",
    country: "해외",
    home: "https://www.alibaba.com/",
    search: "https://www.alibaba.com/trade/search?SearchText=",
    description:
      "영어 검색 권장. MOQ·거래 조건·수입 요건을 공급사에 문의하세요.",
  },
];

export const CATEGORIES = [
  { id: "all", name: "전체 상품", icon: "grid" },
  { id: "living", name: "생활·수납", icon: "box" },
  { id: "kitchen", name: "주방용품", icon: "utensils" },
  { id: "pet", name: "반려동물", icon: "paw" },
  { id: "outdoor", name: "캠핑·레저", icon: "tent" },
  { id: "car", name: "차량용품", icon: "car" },
  { id: "office", name: "문구·사무", icon: "pencil" },
  { id: "fashion", name: "패션·잡화", icon: "bag" },
  { id: "garden", name: "원예·공구", icon: "sprout" },
  { id: "other", name: "기타", icon: "more" },
];

export const FULFILLMENTS = {
  consignment: "위탁배송",
  wholesale: "도매매입",
  overseas: "해외소싱",
  unknown: "방식 확인 필요",
};

export function getSource(product) {
  return (
    SOURCES.find((source) => source.id === product.sourceId) || {
      id: "other",
      name: product.sourceName || "기타 공급사",
      mark: "S",
      tone: "slate",
      type: "직접 등록",
      country: "미확인",
      home: "",
      description: "공급사와 거래 조건을 직접 확인하세요.",
    }
  );
}

export function sourceSearchUrl(source, query = "") {
  return query.trim() && source.search
    ? source.search + encodeURIComponent(query.trim())
    : source.home;
}

export function categoryName(id) {
  return CATEGORIES.find((category) => category.id === id)?.name || "기타";
}
