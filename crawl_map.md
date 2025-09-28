# Crawl Map 
_Auto-generated – refresh to see the latest state_

## Quick overview

| - 

---
### https://ai.shoppingadssolutions.com/api/v11. (untitled) 
**URL:** https://ai.shoppingadssolutions.com/api/v1 
**Links:**

_(none)_

**Endpoint Results:**

- ✅ **GET /metrics**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/metrics `
 ↳ Status: `200 OK`
 ↳ Response Time: `174ms`
 ↳ Response Data:
```
# HELP python_gc_objects_collected_total Objects collected during gc
# TYPE python_gc_objects_collected_total counter
python_gc_objects_collected_total{generation="0"} 477213.0
python_gc_objects_collected_total{generation="1"} 97823.0
python_gc_objects_collected_total{generation="2"} 3583.0
...
```

- ✅ **POST /meta/edit/edit-campaign-field**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/meta/edit/edit-campaign-field?field=test_string&index=test_string `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `95ms`
 ↳ Request Data:
```
{
  "instruction": "test_string",
  "campaigns": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "int_parsing",
      "loc": [
        "query",
        "index"
      ],
      "msg": "Input should be a valid integer, unable to parse string as an integer",
      "input": "test_string"
    },
    {
      "type": "model_attributes_type",
      "loc": [
        "body",
        "campaigns",
        "Campaign"
      ],
      "msg": "Input should be a valid dictionary or object to extract fields from",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "campaigns",
        "list[Campaign]"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    }
  ]
}
```

- ✅ **POST /meta/adset/{campaign_id}/create**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/meta/adset/test_id_123/create?ad_account_id=test_id_123 `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `86ms`
 ↳ Request Data:
```
{
  "name": "test_string",
  "main_goal": "test_string",
  "start_date": "test_string",
  "end_date": "test_string",
  "expected_sales": 123.45,
  "expected_aov": 123.45,
  "daily_campaign_budget": 123.45,
  "location": [
    "test_string"
  ],
  "landing_page_link": "test_string",
  "client_name": "test_string",
  "ideal_customers": "test_value",
  "total_ad_budget": "test_value",
  "audience": "test_value",
  "creatives": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "enum",
      "loc": [
        "body",
        "main_goal"
      ],
      "msg": "Input should be 'sales' or 'leads'",
      "input": "test_string",
      "ctx": {
        "expected": "'sales' or 'leads'"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "start_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "end_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "url_parsing",
      "loc": [
        "body",
        "landing_page_link"
      ],
      "msg": "Input should be a valid URL, relative URL without a base",
      "input": "test_string",
      "ctx": {
        "error": "relative URL without a base"
      }
    },
    {
      "type": "float_parsing",
      "loc": [
        "body",
        "total_ad_budget"
      ],
      "msg": "Input should be a valid number, unable to parse string as a number",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "audience"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "creatives"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    }
  ]
}
```

- ✅ **POST /meta/ad/{adset_id}/create**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/meta/ad/test_id_123/create?ad_account_id=test_id_123&page_id=test_id_123 `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `92ms`
 ↳ Request Data:
```
{
  "name": "test_string",
  "main_goal": "test_string",
  "start_date": "test_string",
  "end_date": "test_string",
  "expected_sales": 123.45,
  "expected_aov": 123.45,
  "daily_campaign_budget": 123.45,
  "location": [
    "test_string"
  ],
  "creative_notes": "test_value",
  "landing_page_link": "test_string",
  "client_name": "test_string",
  "image": "test_value",
  "store_uniqueness": "test_value",
  "why_choose_store": "test_value",
  "ideal_customers": "test_value",
  "customer_problems_needs": "test_value",
  "store_tone_personality": "test_value",
  "total_ad_budget": "test_value",
  "youtube_links": "test_value",
  "creatives": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "enum",
      "loc": [
        "body",
        "main_goal"
      ],
      "msg": "Input should be 'sales' or 'leads'",
      "input": "test_string",
      "ctx": {
        "expected": "'sales' or 'leads'"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "start_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "end_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "url_parsing",
      "loc": [
        "body",
        "landing_page_link"
      ],
      "msg": "Input should be a valid URL, relative URL without a base",
      "input": "test_string",
      "ctx": {
        "error": "relative URL without a base"
      }
    },
    {
      "type": "float_parsing",
      "loc": [
        "body",
        "total_ad_budget"
      ],
      "msg": "Input should be a valid number, unable to parse string as a number",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "creatives"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    }
  ]
}
```

- ✅ **GET /meta/auth/facebook**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/meta/auth/facebook `
 ↳ Status: `400 Bad Request`
 ↳ Response Time: `1032ms`
 ↳ Response Data:
```
<!DOCTYPE html><html lang="en" id="facebook"><head><title>Error</title><meta charset="utf-8" /><meta http-equiv="Cache-Control" content="no-cache" /><meta name="robots" content="noindex,nofollow" /><style nonce="RWr2meLP">html, body { color: #333; font-family: 'Lucida Grande', 'Tahoma', 'Verdana', '...
```

- ✅ **GET /meta/auth/facebook/callback**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/meta/auth/facebook/callback?code=test_string&state=test_string `
 ↳ Status: `500 Internal Server Error`
 ↳ Response Time: `148ms`
 ↳ Response Data:
```
{
  "detail": "Authentication failed"
}
```

- ✅ **GET /meta/**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/meta/ `
 ↳ Status: `200 OK`
 ↳ Response Time: `86ms`
 ↳ Response Data:
```
[
  "Generate Campaigns on Meta"
]
```

- ✅ **POST /meta/generate**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/meta/generate?choice=test_string `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `93ms`
 ↳ Request Data:
```
{
  "name": "test_string",
  "main_goal": "test_string",
  "start_date": "test_string",
  "end_date": "test_string",
  "expected_sales": 123.45,
  "expected_aov": 123.45,
  "daily_campaign_budget": 123.45,
  "location": [
    "test_string"
  ],
  "creative_notes": "test_value",
  "landing_page_link": "test_string",
  "client_name": "test_string",
  "image": "test_value",
  "store_uniqueness": "test_value",
  "total_ad_budget": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "bool_parsing",
      "loc": [
        "query",
        "choice"
      ],
      "msg": "Input should be a valid boolean, unable to interpret input",
      "input": "test_string"
    },
    {
      "type": "enum",
      "loc": [
        "body",
        "main_goal"
      ],
      "msg": "Input should be 'sales' or 'leads'",
      "input": "test_string",
      "ctx": {
        "expected": "'sales' or 'leads'"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "start_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "end_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "url_parsing",
      "loc": [
        "body",
        "landing_page_link"
      ],
      "msg": "Input should be a valid URL, relative URL without a base",
      "input": "test_string",
      "ctx": {
        "error": "relative URL without a base"
      }
    },
    {
      "type": "float_parsing",
      "loc": [
        "body",
        "total_ad_budget"
      ],
      "msg": "Input should be a valid number, unable to parse string as a number",
      "input": "test_value"
    }
  ]
}
```

- ✅ **POST /meta/launch**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/meta/launch?ad_account_id=test_id_123&index=test_string&autogen=true&page_id=test_id_123 `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `81ms`
 ↳ Request Data:
```
{
  "campaigns": "test_value",
  "brand_data": "test_value",
  "pmax_data": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "int_parsing",
      "loc": [
        "query",
        "index"
      ],
      "msg": "Input should be a valid integer, unable to parse string as an integer",
      "input": "test_string"
    },
    {
      "type": "model_attributes_type",
      "loc": [
        "body",
        "campaigns",
        "Campaign"
      ],
      "msg": "Input should be a valid dictionary or object to extract fields from",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "campaigns",
        "list[Campaign]"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    },
    {
      "type": "model_attributes_type",
      "loc": [
        "body",
        "brand_data"
      ],
      "msg": "Input should be a valid dictionary or object to extract fields from",
      "input": "test_value"
    },
    {
      "type": "model_attributes_type",
      "loc": [
        "body",
        "pmax_data"
      ],
      "msg": "Input should be a valid dictionary or object to extract fields from",
      "input": "test_value"
    }
  ]
}
```

- ✅ **POST /meta/{campaign_id}/autogen**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/meta/test_id_123/autogen?ad_account_id=test_id_123&page_id=test_id_123 `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `84ms`
 ↳ Request Data:
```
{
  "name": "test_string",
  "main_goal": "test_string",
  "start_date": "test_string",
  "end_date": "test_string",
  "expected_sales": 123.45,
  "expected_aov": 123.45,
  "daily_campaign_budget": 123.45,
  "location": [
    "test_string"
  ],
  "landing_page_link": "test_string",
  "client_name": "test_string",
  "image": "test_value",
  "ideal_customers": "test_value",
  "store_tone_personality": "test_value",
  "store_values_phrases": "test_value",
  "total_ad_budget": "test_value",
  "audience": "test_value",
  "creatives": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "enum",
      "loc": [
        "body",
        "main_goal"
      ],
      "msg": "Input should be 'sales' or 'leads'",
      "input": "test_string",
      "ctx": {
        "expected": "'sales' or 'leads'"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "start_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "end_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "url_parsing",
      "loc": [
        "body",
        "landing_page_link"
      ],
      "msg": "Input should be a valid URL, relative URL without a base",
      "input": "test_string",
      "ctx": {
        "error": "relative URL without a base"
      }
    },
    {
      "type": "float_parsing",
      "loc": [
        "body",
        "total_ad_budget"
      ],
      "msg": "Input should be a valid number, unable to parse string as a number",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "audience"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "creatives"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    }
  ]
}
```

- ✅ **POST /meta/test/targeting**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/meta/test/targeting `
 ↳ Status: `500 Internal Server Error`
 ↳ Response Time: `88ms`
 ↳ Request Data:
```
{
  "description": "test_string"
}
```
 ↳ Response Data:
```
{
  "detail": "object dict can't be used in 'await' expression"
}
```

- ✅ **GET /google/**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/google/ `
 ↳ Status: `200 OK`
 ↳ Response Time: `93ms`
 ↳ Response Data:
```
[
  "Generate Campaigns on Meta"
]
```

- ✅ **POST /google/generate**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/google/generate?choice=test_string `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `85ms`
 ↳ Request Data:
```
{
  "name": "test_string",
  "main_goal": "test_string",
  "start_date": "test_string",
  "end_date": "test_string",
  "expected_sales": 123.45,
  "expected_aov": 123.45,
  "daily_campaign_budget": 123.45,
  "location": [
    "test_string"
  ],
  "creative_notes": "test_value",
  "landing_page_link": "test_string",
  "client_name": "test_string",
  "image": "test_value",
  "ideal_customers": "test_value",
  "store_values_phrases": "test_value",
  "total_ad_budget": "test_value",
  "audience": "test_value",
  "youtube_links": "test_value",
  "creatives": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "bool_parsing",
      "loc": [
        "query",
        "choice"
      ],
      "msg": "Input should be a valid boolean, unable to interpret input",
      "input": "test_string"
    },
    {
      "type": "enum",
      "loc": [
        "body",
        "main_goal"
      ],
      "msg": "Input should be 'sales' or 'leads'",
      "input": "test_string",
      "ctx": {
        "expected": "'sales' or 'leads'"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "start_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "end_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "url_parsing",
      "loc": [
        "body",
        "landing_page_link"
      ],
      "msg": "Input should be a valid URL, relative URL without a base",
      "input": "test_string",
      "ctx": {
        "error": "relative URL without a base"
      }
    },
    {
      "type": "float_parsing",
      "loc": [
        "body",
        "total_ad_budget"
      ],
      "msg": "Input should be a valid number, unable to parse string as a number",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "audience"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "creatives"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    }
  ]
}
```

- ✅ **POST /google/launch**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/google/launch?ad_account_id=test_id_123&index=test_string&autogen=true&campaign_type=test_string&merchant_id=test_id_123 `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `88ms`
 ↳ Request Data:
```
{
  "campaigns": "test_value",
  "brand_data": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "int_parsing",
      "loc": [
        "query",
        "index"
      ],
      "msg": "Input should be a valid integer, unable to parse string as an integer",
      "input": "test_string"
    },
    {
      "type": "int_parsing",
      "loc": [
        "query",
        "merchant_id"
      ],
      "msg": "Input should be a valid integer, unable to parse string as an integer",
      "input": "test_id_123"
    },
    {
      "type": "model_attributes_type",
      "loc": [
        "body",
        "campaigns",
        "Campaign"
      ],
      "msg": "Input should be a valid dictionary or object to extract fields from",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "campaigns",
        "list[Campaign]"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    },
    {
      "type": "model_attributes_type",
      "loc": [
        "body",
        "brand_data"
      ],
      "msg": "Input should be a valid dictionary or object to extract fields from",
      "input": "test_value"
    }
  ]
}
```

- ✅ **POST /google/{campaign_id}/autogen**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/google/test_id_123/autogen?ad_account_id=test_id_123 `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `80ms`
 ↳ Request Data:
```
{
  "name": "test_string",
  "main_goal": "test_string",
  "start_date": "test_string",
  "end_date": "test_string",
  "expected_sales": 123.45,
  "expected_aov": 123.45,
  "daily_campaign_budget": 123.45,
  "location": [
    "test_string"
  ],
  "creative_notes": "test_value",
  "landing_page_link": "test_string",
  "client_name": "test_string",
  "store_uniqueness": "test_value",
  "total_ad_budget": "test_value",
  "audience": "test_value",
  "creatives": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "enum",
      "loc": [
        "body",
        "main_goal"
      ],
      "msg": "Input should be 'sales' or 'leads'",
      "input": "test_string",
      "ctx": {
        "expected": "'sales' or 'leads'"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "start_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "end_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "url_parsing",
      "loc": [
        "body",
        "landing_page_link"
      ],
      "msg": "Input should be a valid URL, relative URL without a base",
      "input": "test_string",
      "ctx": {
        "error": "relative URL without a base"
      }
    },
    {
      "type": "float_parsing",
      "loc": [
        "body",
        "total_ad_budget"
      ],
      "msg": "Input should be a valid number, unable to parse string as a number",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "audience"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "creatives"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    }
  ]
}
```

- ✅ **GET /tiktok/**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/tiktok/ `
 ↳ Status: `200 OK`
 ↳ Response Time: `86ms`
 ↳ Response Data:
```
[
  "Generate Campaigns on Meta"
]
```

- ✅ **POST /tiktok/generate**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/tiktok/generate?choice=test_string `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `87ms`
 ↳ Request Data:
```
{
  "name": "test_string",
  "main_goal": "test_string",
  "start_date": "test_string",
  "end_date": "test_string",
  "expected_sales": 123.45,
  "expected_aov": 123.45,
  "daily_campaign_budget": 123.45,
  "location": [
    "test_string"
  ],
  "creative_notes": "test_value",
  "landing_page_link": "test_string",
  "client_name": "test_string",
  "image": "test_value",
  "store_uniqueness": "test_value",
  "store_values_phrases": "test_value",
  "youtube_links": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "bool_parsing",
      "loc": [
        "query",
        "choice"
      ],
      "msg": "Input should be a valid boolean, unable to interpret input",
      "input": "test_string"
    },
    {
      "type": "enum",
      "loc": [
        "body",
        "main_goal"
      ],
      "msg": "Input should be 'sales' or 'leads'",
      "input": "test_string",
      "ctx": {
        "expected": "'sales' or 'leads'"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "start_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "end_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "url_parsing",
      "loc": [
        "body",
        "landing_page_link"
      ],
      "msg": "Input should be a valid URL, relative URL without a base",
      "input": "test_string",
      "ctx": {
        "error": "relative URL without a base"
      }
    }
  ]
}
```

- ✅ **POST /tiktok/launch**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/tiktok/launch?ad_account_id=test_id_123&index=test_string&autogen=true&page_id=test_id_123 `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `94ms`
 ↳ Request Data:
```
{
  "campaigns": "test_value",
  "brand_data": "test_value",
  "pmax_data": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "int_parsing",
      "loc": [
        "query",
        "index"
      ],
      "msg": "Input should be a valid integer, unable to parse string as an integer",
      "input": "test_string"
    },
    {
      "type": "model_attributes_type",
      "loc": [
        "body",
        "campaigns",
        "Campaign"
      ],
      "msg": "Input should be a valid dictionary or object to extract fields from",
      "input": "test_value"
    },
    {
      "type": "list_type",
      "loc": [
        "body",
        "campaigns",
        "list[Campaign]"
      ],
      "msg": "Input should be a valid list",
      "input": "test_value"
    },
    {
      "type": "model_attributes_type",
      "loc": [
        "body",
        "brand_data"
      ],
      "msg": "Input should be a valid dictionary or object to extract fields from",
      "input": "test_value"
    },
    {
      "type": "model_attributes_type",
      "loc": [
        "body",
        "pmax_data"
      ],
      "msg": "Input should be a valid dictionary or object to extract fields from",
      "input": "test_value"
    }
  ]
}
```

- ✅ **POST /tiktok/{campaign_id}/autogen**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/tiktok/test_id_123/autogen?ad_account_id=test_id_123&page_id=test_id_123 `
 ↳ Status: `422 Unprocessable Entity`
 ↳ Response Time: `89ms`
 ↳ Request Data:
```
{
  "name": "test_string",
  "main_goal": "test_string",
  "start_date": "test_string",
  "end_date": "test_string",
  "expected_sales": 123.45,
  "expected_aov": 123.45,
  "daily_campaign_budget": 123.45,
  "location": [
    "test_string"
  ],
  "landing_page_link": "test_string",
  "client_name": "test_string",
  "ideal_customers": "test_value",
  "store_tone_personality": "test_value",
  "store_values_phrases": "test_value",
  "youtube_links": "test_value"
}
```
 ↳ Response Data:
```
{
  "detail": [
    {
      "type": "enum",
      "loc": [
        "body",
        "main_goal"
      ],
      "msg": "Input should be 'sales' or 'leads'",
      "input": "test_string",
      "ctx": {
        "expected": "'sales' or 'leads'"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "start_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "date_from_datetime_parsing",
      "loc": [
        "body",
        "end_date"
      ],
      "msg": "Input should be a valid date or datetime, invalid character in year",
      "input": "test_string",
      "ctx": {
        "error": "invalid character in year"
      }
    },
    {
      "type": "url_parsing",
      "loc": [
        "body",
        "landing_page_link"
      ],
      "msg": "Input should be a valid URL, relative URL without a base",
      "input": "test_string",
      "ctx": {
        "error": "relative URL without a base"
      }
    }
  ]
}
```

- ✅ **GET /**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/ `
 ↳ Status: `200 OK`
 ↳ Response Time: `86ms`
 ↳ Response Data:
```
[
  "Welcome to Shopping Ads Solutions Campaign Generator"
]
```

- ✅ **GET /health**
 ↳ Endpoint: `https://ai.shoppingadssolutions.com/api/v1/health `
 ↳ Status: `200 OK`
 ↳ Response Time: `84ms`
 ↳ Response Data:
```
{
  "status": "ok",
  "redis": true
}
```

---
