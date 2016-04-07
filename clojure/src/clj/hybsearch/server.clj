(ns hybsearch.server
  (:require [org.httpkit.server :as hk]
            [clojure.java.io :as io]
            [taoensso.sente :as sente]
            [taoensso.sente.server-adapters.http-kit :refer [sente-web-server-adapter]]
            [ring.middleware.file :as file]
            [ring.middleware.file-info :as file-info]
            [ring.middleware.keyword-params :as keyword-params]
            [ring.middleware.multipart-params :as multipart-params]
            [ring.middleware.params :as params]
            [ring.middleware.session :as session]
            [compojure.core :refer :all]
            [compojure.route :as route]
            [ring.util.response :as resp]
            [hybsearch.api :as api]
            [tailrecursion.cljson :refer [clj->cljson cljson->clj]]))

;; The server, in all its glory!
(defonce server (atom nil))

;; Channel socket definitions.
(let [{:keys [ch-recv send-fn ajax-post-fn ajax-get-or-ws-handshake-fn
              connected-uids]}
      (sente/make-channel-socket! sente-web-server-adapter {})]
  (def ring-ajax-post                ajax-post-fn)
  (def ring-ajax-get-or-ws-handshake ajax-get-or-ws-handshake-fn)
  (def ch-chsk                       ch-recv) ; ChannelSocket's receive channel
  (def chsk-send!                    send-fn) ; ChannelSocket's send API fn
  (def connected-uids                connected-uids) ; Watchable, read-only atom
  )

;; -----------------------
;; Data Push Functions
;; -----------------------

(defn push-jobs-state-everywhere []
  (chsk-send!
    :sente/all-users-without-uid
    [:rpc/recv-jobs-state (api/get-jobs-state)]))

(defn push-analysis-set-seqs-everywhere []
  (chsk-send!
    :sente/all-users-without-uid
    [:rpc/recv-analysis-set-sequences (api/get-analysis-set-sequences)]))


;; -----------------------
;; Channel Socket Handler functions
;; -----------------------
(defmulti event-msg-handler :id) ; Dispatch on event-id

;; Wrap for logging, catching, etc.:
(defn event-msg-handler* [{:as ev-msg :keys [id ?data event]}]
  (println "Event:" event)
  (event-msg-handler ev-msg))

(defmethod event-msg-handler :default
  [{:as ev-msg :keys [event id ?data ring-req ?reply-fn send-fn]}]
  (let [session (:session ring-req)
        uid     (:uid     session)]
    (println "Unhandled event:" event)
    (when ?reply-fn
      (?reply-fn {:umatched-event-as-echoed-from-from-server event}))))

(defmethod event-msg-handler :chsk/state
  [{:as ev-msg :keys [?data]}]
  (if (= (:first-open? ?data) true)
    (println "Channel socket successfully established.")
    (println "Channel socket state change: " ?data)))

(defmethod event-msg-handler :rpc/run-job
  [{:as ev-msg :keys [?data]}]
  (api/run-job ?data))

(defmethod event-msg-handler :rpc/pause-job
  [{:as ev-msg :keys [?data]}]
  (api/pause-job ?data))

(defmethod event-msg-handler :rpc/query-nonmonophyly
  [{:as ev-msg :keys [?data ?reply-fn]}]
  (when ?reply-fn
    (?reply-fn (api/query-nonmonophyly ?data))))

(defmethod event-msg-handler :rpc/get-jobs-state
  [{:as ev-msg :keys [?reply-fn]}]
  (when ?reply-fn
    (?reply-fn (api/get-jobs-state))))

(defmethod event-msg-handler :rpc/get-analysis-set-sequences
  [{:as ev-msg :keys [?reply-fn]}]
  (when ?reply-fn
    (?reply-fn (api/get-analysis-set-sequences))))

;; -----------------------
;; URL Routing Functions
;; -----------------------

(defn create-analysis-set
  [{set-name :name {tempfile :tempfile} :file :as params}]
  (try
    (api/create-analysis-set set-name tempfile)
    (push-analysis-set-seqs-everywhere)
    "OK! Analysis set created!" ;; Todo: Correct status code
    (catch Exception e {:status 500
                        :body (str e " Oops! An error occured: Your analysis set was probably not created.")})))

(defn create-clustal-scheme [scheme-data]
  (try
    (api/create-clustal-scheme scheme-data)
    "Scheme successfully created." ;; Todo: Correct status code
    (catch Exception e {:status 500
                        :body (str e " Oops! An error occured: Your clustal scheme was probably not created.")})))


;; -----------------------
;; Route Defs
;; -----------------------
(defroutes all-routes
  (GET "/" [] (resp/file-response "index.html" {:root "public"}))
  (GET  "/chsk" req (ring-ajax-get-or-ws-handshake req))
  (POST "/analysis-sets/new" {params :params} (create-analysis-set params))
  (POST "/clustal-schemes/new" {params :params} (create-clustal-scheme params))
  (POST "/chsk" req (ring-ajax-post req))
  (route/resources "/")
  (route/not-found "<h1>404.</h1>"))


;; Set updated-fn for api to use.
(api/reset-updated-fn! push-jobs-state-everywhere)

;; Sente router
(defonce router_ (atom nil))
(defn  stop-router! [] (when-let [stop-f @router_] (stop-f)))
(defn start-router! []
  (stop-router!)
  (reset! router_ (sente/start-chsk-router! ch-chsk event-msg-handler*)))

;; Session setup
(defn middleware [public-path]
  (-> all-routes
      (keyword-params/wrap-keyword-params)
      (multipart-params/wrap-multipart-params)
      (params/wrap-params)
      (file/wrap-file public-path)
      (file-info/wrap-file-info)))

(defn start-server [port public-path]
  (start-router!)
  (swap! server #(or % (hk/run-server
                         (middleware public-path)
                         {:port port :join? false}))))