const zone={timeZone:'Asia/Kuwait'};
export const calendarDate=value=>new Intl.DateTimeFormat('en-GB',{...zone,day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value));
export const formatTime=value=>new Intl.DateTimeFormat('en-US',{...zone,hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value)).replace(/\s+/gu,' ');
