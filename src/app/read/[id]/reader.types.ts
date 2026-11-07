export type Bookmark = {
  created_at: string;
  id: string;
  label: string | null;
  page: number;
};

export type HighlightRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type Highlight = {
  color: string;
  created_at: string;
  id: string;
  page: number;
  rects: HighlightRect[];
  text: string;
};

export type ReaderProps = {
  bookId: string;
  initialBookmarks: Bookmark[];
  initialDataError: string | null;
  initialHighlights: Highlight[];
  initialLastPage: number;
  initialReadTill: number;
  initialNumPages: number;
  signedUrl: string;
  storagePath?: string;
  title: string;
  userId: string;
};
